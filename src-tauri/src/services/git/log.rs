use std::path::Path;

use crate::error::AppResult;
use crate::models::git::Commit;

use super::run_git;

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';

pub fn list(path: &Path, limit: u32, skip: u32, all: bool) -> AppResult<Vec<Commit>> {
    let limit = limit.clamp(1, 500);
    let skip = skip.min(100_000);
    let format = format!(
        "--pretty=format:%H{0}%h{0}%P{0}%an{0}%ae{0}%aI{0}%s{0}%D{1}",
        FIELD, RECORD
    );
    let max_count = format!("--max-count={limit}");
    let skip_arg = format!("--skip={skip}");

    let mut args: Vec<&str> = vec!["log", "--date-order", &max_count, &skip_arg, &format];
    if all {
        args.insert(1, "--all");
    }

    let output = run_git(path, args.as_slice())?;
    let mut commits = Vec::new();

    for record in output.split(RECORD) {
        let record = record.trim_matches('\n');
        if record.is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split(FIELD).collect();
        if fields.len() < 8 {
            continue;
        }

        commits.push(Commit {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            parents: fields[2]
                .split_whitespace()
                .map(str::to_string)
                .collect(),
            author: fields[3].to_string(),
            email: fields[4].to_string(),
            date: fields[5].to_string(),
            subject: fields[6].to_string(),
            refs: fields[7]
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect(),
        });
    }

    Ok(commits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "ChenADE Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "ChenADE Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .status()
            .expect("run git");
        assert!(status.success(), "git {:?} failed", args);
    }

    #[test]
    fn lists_commits_newest_first() {
        let dir = tempfile::tempdir().expect("tempdir");
        run_git(dir.path(), &["init", "-b", "main"]);
        std::fs::write(dir.path().join("README.md"), "one\n").expect("write");
        run_git(dir.path(), &["add", "."]);
        run_git(dir.path(), &["commit", "-m", "first"]);
        std::fs::write(dir.path().join("README.md"), "two\n").expect("write");
        run_git(dir.path(), &["add", "."]);
        run_git(dir.path(), &["commit", "-m", "second"]);

        let commits = list(dir.path(), 10, 0, false).expect("log");
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "second");
        assert_eq!(commits[1].subject, "first");
        assert_eq!(commits[0].parents.len(), 1);
    }
}
