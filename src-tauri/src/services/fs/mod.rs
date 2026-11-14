use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::fs::{FileContent, FileEntry, WriteResult};

const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DIR_ENTRIES: usize = 4000;
const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    ".cache",
    "vendor",
];

/// Canonicalize both paths and ensure the target stays inside the worktree root.
pub fn resolve_in_root(root: &Path, path: &Path) -> AppResult<(PathBuf, PathBuf)> {
    let canonical_root = std::fs::canonicalize(root).map_err(|error| {
        AppError::new("PATH_NOT_FOUND", "工作树目录不存在")
            .detail(format!("{}: {error}", root.display()))
    })?;
    let canonical_path = std::fs::canonicalize(path).map_err(|error| {
        AppError::new("PATH_NOT_FOUND", "文件或目录不存在")
            .detail(format!("{}: {error}", path.display()))
    })?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err(AppError::new(
            "PATH_OUTSIDE_ROOT",
            "这个路径不在当前工作树内",
        ));
    }

    Ok((canonical_root, canonical_path))
}

pub fn list_dir(root: &Path, path: &Path) -> AppResult<Vec<FileEntry>> {
    let (_, directory) = resolve_in_root(root, path)?;

    if !directory.is_dir() {
        return Err(AppError::new("NOT_A_DIRECTORY", "这个路径不是目录"));
    }

    let mut entries = Vec::new();
    let reader = std::fs::read_dir(&directory).map_err(|error| {
        AppError::new("PERMISSION_DENIED", "无法读取目录")
            .detail(format!("{}: {error}", directory.display()))
    })?;

    for entry in reader.flatten() {
        if entries.len() >= MAX_DIR_ENTRIES {
            break;
        }

        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();

        if name == ".DS_Store" {
            continue;
        }
        if file_type.is_dir() && IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }

        let metadata = entry.metadata().ok();
        let is_symlink = file_type.is_symlink();
        let is_dir = metadata
            .as_ref()
            .map(|value| value.is_dir())
            .unwrap_or(file_type.is_dir());
        let size = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
        let modified = metadata
            .as_ref()
            .and_then(|value| value.modified().ok())
            .map(|value| chrono::DateTime::<chrono::Utc>::from(value).to_rfc3339());

        entries.push(FileEntry {
            name,
            path: entry.path().display().to_string(),
            is_dir,
            is_symlink,
            size,
            modified,
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(entries)
}

pub fn read_file(root: &Path, path: &Path) -> AppResult<FileContent> {
    let (_, file) = resolve_in_root(root, path)?;

    let metadata = std::fs::metadata(&file)?;
    if metadata.is_dir() {
        return Err(AppError::new("NOT_A_FILE", "这个路径不是文件"));
    }
    if metadata.len() > MAX_READ_BYTES {
        return Err(AppError::new("FILE_TOO_LARGE", "文件过大，无法在应用内预览")
            .detail(format!("{} bytes", metadata.len()))
            .hint("在外部编辑器中打开"));
    }

    let bytes = std::fs::read(&file)?;
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(AppError::new("FILE_BINARY", "二进制文件无法预览")
            .hint("在外部编辑器中打开"));
    }

    let content = String::from_utf8_lossy(&bytes).to_string();
    let language = language_for(&file);

    Ok(FileContent {
        path: file.display().to_string(),
        content,
        language,
        encoding: "UTF-8".to_string(),
        size: metadata.len(),
        truncated: false,
    })
}

pub fn write_file(root: &Path, path: &Path, content: &str) -> AppResult<WriteResult> {
    // Resolve first so a symlink or `..` segment cannot write outside the
    // worktree root.
    let (_, file) = resolve_in_root(root, path)?;

    let metadata = std::fs::metadata(&file)?;
    if metadata.is_dir() {
        return Err(AppError::new("NOT_A_FILE", "这个路径不是文件"));
    }

    std::fs::write(&file, content.as_bytes()).map_err(|error| match error.kind() {
        std::io::ErrorKind::PermissionDenied => {
            AppError::new("PERMISSION_DENIED", "没有权限写入这个文件")
                .detail(format!("{}: {error}", file.display()))
        }
        _ => AppError::new("IO_ERROR", "写入文件失败")
            .detail(format!("{}: {error}", file.display())),
    })?;

    let updated = std::fs::metadata(&file)?;

    Ok(WriteResult {
        path: file.display().to_string(),
        size: updated.len(),
        modified: updated
            .modified()
            .ok()
            .map(|value| chrono::DateTime::<chrono::Utc>::from(value).to_rfc3339()),
    })
}

fn language_for(path: &Path) -> String {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let language = match extension.as_str() {
        "ts" => "TypeScript",
        "tsx" => "TypeScript React",
        "js" | "mjs" | "cjs" => "JavaScript",
        "jsx" => "JavaScript React",
        "json" => "JSON",
        "css" => "CSS",
        "scss" => "SCSS",
        "md" | "markdown" => "Markdown",
        "html" | "htm" => "HTML",
        "rs" => "Rust",
        "py" => "Python",
        "go" => "Go",
        "java" => "Java",
        "c" => "C",
        "cpp" | "cc" | "hpp" => "C++",
        "h" => "C",
        "swift" => "Swift",
        "sh" | "zsh" | "bash" => "Shell",
        "yml" | "yaml" => "YAML",
        "toml" => "TOML",
        "sql" => "SQL",
        _ => "",
    };

    if !language.is_empty() {
        return language.to_string();
    }
    if extension.is_empty() {
        "Text".to_string()
    } else {
        extension.to_uppercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn workspace() -> TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("src")).expect("src");
        fs::write(dir.path().join("README.md"), "# hello\n").expect("readme");
        fs::write(dir.path().join("src/main.ts"), "export const value = 1;\n").expect("ts");
        dir
    }

    #[test]
    fn lists_directories_first() {
        let dir = workspace();
        let entries = list_dir(dir.path(), dir.path()).expect("list");
        assert_eq!(entries[0].name, "src");
        assert!(entries[0].is_dir);
        assert!(entries.iter().any(|entry| entry.name == "README.md"));
    }

    #[test]
    fn reads_text_files() {
        let dir = workspace();
        let content = read_file(dir.path(), &dir.path().join("src/main.ts")).expect("read");
        assert!(content.content.contains("export const"));
        assert_eq!(content.language, "TypeScript");
    }

    #[test]
    fn rejects_paths_outside_root() {
        let dir = workspace();
        let outside = tempfile::tempdir().expect("outside");
        let error = read_file(dir.path(), &outside.path().join("x.txt")).expect_err("should fail");
        assert!(error.code == "PATH_NOT_FOUND" || error.code == "PATH_OUTSIDE_ROOT");
    }

    #[test]
    fn writes_text_files_and_reports_metadata() {
        let dir = workspace();
        let target = dir.path().join("src/main.ts");
        let result = write_file(dir.path(), &target, "export const value = 2;\n").expect("write");

        assert!(std::path::Path::new(&result.path).ends_with(std::path::Path::new("src").join("main.ts")));
        assert_eq!(result.size, 24);
        assert!(result.modified.is_some());
        assert_eq!(
            fs::read_to_string(&target).expect("read back"),
            "export const value = 2;\n"
        );
    }

    #[test]
    fn write_rejects_paths_outside_root() {
        let dir = workspace();
        let outside = tempfile::tempdir().expect("outside");
        let target = outside.path().join("escape.txt");
        fs::write(&target, "original").expect("seed");

        let error = write_file(dir.path(), &target, "hacked").expect_err("should fail");
        assert!(error.code == "PATH_NOT_FOUND" || error.code == "PATH_OUTSIDE_ROOT");
        assert_eq!(fs::read_to_string(&target).expect("unchanged"), "original");
    }

    #[test]
    fn write_rejects_directories() {
        let dir = workspace();
        let error = write_file(dir.path(), &dir.path().join("src"), "x").expect_err("should fail");
        assert_eq!(error.code, "NOT_A_FILE");
    }

    #[test]
    fn rejects_binary_files() {
        let dir = workspace();
        fs::write(dir.path().join("binary.bin"), [0u8, 1, 2, 3]).expect("binary");
        let error = read_file(dir.path(), &dir.path().join("binary.bin")).expect_err("should fail");
        assert_eq!(error.code, "FILE_BINARY");
    }
}
