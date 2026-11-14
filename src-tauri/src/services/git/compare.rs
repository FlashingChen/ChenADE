use std::path::Path;

use crate::error::AppResult;
use crate::models::git::Branch;

use super::repo::remote_info;

pub fn compare_url(path: &Path, base: &str, head: &str) -> AppResult<Option<String>> {
    let remote = remote_info(path);
    let Some(url) = remote.url else {
        return Ok(None);
    };
    let Some(provider) = remote.provider.as_deref() else {
        return Ok(None);
    };

    let Some((host, repository)) = parse_remote(&url) else {
        return Ok(None);
    };

    let base = base.trim().trim_start_matches("origin/");
    let head = head.trim().trim_start_matches("origin/");
    if base.is_empty() || head.is_empty() {
        return Ok(None);
    }

    let encoded = |value: &str| {
        value
            .replace(' ', "%20")
            .replace('#', "%23")
            .replace('?', "%3F")
    };

    let url = match provider {
        "github" => format!(
            "https://github.com/{repository}/compare/{}...{}?expand=1",
            encoded(base),
            encoded(head)
        ),
        "gitlab" => format!(
            "https://{host}/{repository}/-/compare/{}...{}",
            encoded(base),
            encoded(head)
        ),
        _ => return Ok(None),
    };

    Ok(Some(url))
}

fn parse_remote(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches(".git");

    if let Some(rest) = trimmed.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        return Some((host.to_string(), path.trim_matches('/').to_string()));
    }

    if let Some(rest) = trimmed.strip_prefix("ssh://git@") {
        let (host, path) = rest.split_once('/')?;
        return Some((host.to_string(), path.trim_matches('/').to_string()));
    }

    if let Ok(parsed) = url::Url::parse(trimmed) {
        let host = parsed.host_str()?.to_string();
        let path = parsed.path().trim_matches('/').to_string();
        return Some((host, path));
    }

    None
}

#[allow(dead_code)]
pub fn head_branch(path: &Path) -> AppResult<Option<String>> {
    let output = super::run_git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let value = output.trim();
    Ok(if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    })
}

#[allow(dead_code)]
pub fn branch_names(path: &Path) -> AppResult<Vec<String>> {
    let output = super::run_git(path, ["branch", "--format=%(refname:short)"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>())
}

#[allow(dead_code)]
pub fn as_branch(name: &str, hash: &str) -> Branch {
    Branch {
        name: name.to_string(),
        hash: hash.to_string(),
        updated_at: None,
        is_current: false,
    }
}
