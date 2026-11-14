use std::path::{Path, PathBuf};

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::git::GitStatus;
use crate::models::worktree::Worktree;
use crate::services::db::Db;
use crate::services::git::repo::{canonical_dir, expand_path};
use crate::services::git::{status, worktree};

#[tauri::command]
pub fn worktrees_list(db: State<'_, Db>, project_id: String) -> AppResult<Vec<Worktree>> {
    let project = db.get_project(&project_id)?;
    worktree::list_worktrees(
        &project.id,
        Path::new(&project.path),
        &project.default_branch,
    )
}

#[tauri::command]
pub fn worktree_status(db: State<'_, Db>, path: String) -> AppResult<GitStatus> {
    let target = ensure_registered(&db, &path)?;
    status::get(&target)
}

pub fn ensure_registered(db: &Db, input: &str) -> AppResult<PathBuf> {
    let target = canonical_dir(&expand_path(input))?;
    let roots = db.project_paths()?;

    for root in roots {
        let root = PathBuf::from(root);
        if target.starts_with(&root) {
            return Ok(target);
        }

        if let Ok(output) = crate::services::git::run_git(&root, ["worktree", "list", "--porcelain"]) {
            for line in output.lines() {
                let Some(raw) = line.strip_prefix("worktree ") else {
                    continue;
                };
                let candidate = PathBuf::from(raw);
                let candidate = std::fs::canonicalize(&candidate).unwrap_or(candidate);
                if candidate == target {
                    return Ok(target);
                }
            }
        }
    }

    Err(AppError::new(
        "PATH_OUTSIDE_ROOT",
        "这个路径不属于任何已添加的项目",
    )
    .hint("先添加对应的 Git 仓库"))
}

#[tauri::command]
pub fn worktree_create(
    db: State<'_, Db>,
    input: crate::models::worktree::CreateWorktreeInput,
) -> AppResult<Worktree> {
    let project = db.get_project(&input.project_id)?;
    let root = Path::new(&project.path);
    worktree::create(&input, root, &project.default_branch)
}

#[tauri::command]
pub fn git_branches(db: State<'_, Db>, path: String) -> AppResult<Vec<crate::models::git::Branch>> {
    let root = ensure_registered(&db, &path)?;
    worktree::branches(&root)
}

#[tauri::command]
pub fn worktree_remove(
    db: State<'_, Db>,
    project_id: String,
    path: String,
    force: Option<bool>,
) -> AppResult<()> {
    let project = db.get_project(&project_id)?;
    let root = std::fs::canonicalize(&project.path).map_err(|error| {
        AppError::new("REPO_NOT_FOUND", "项目目录不存在").detail(error.to_string())
    })?;
    let target = std::fs::canonicalize(expand_path(&path)).map_err(|error| {
        AppError::new("WORKTREE_NOT_FOUND", "工作树目录不存在").detail(error.to_string())
    })?;

    if target == root {
        return Err(AppError::new("INVALID_INPUT", "不能删除主仓库工作树")
            .hint("主仓库请直接在文件管理器中处理"));
    }

    let worktrees = worktree::list_worktrees(&project.id, &root, &project.default_branch)?;
    if !worktrees.iter().any(|item| {
        std::fs::canonicalize(&item.path)
            .map(|candidate| candidate == target)
            .unwrap_or(false)
    }) {
        return Err(AppError::new("WORKTREE_NOT_FOUND", "这个目录不是该仓库的工作树"));
    }

    worktree::remove(&root, &target, force.unwrap_or(false))
}

#[tauri::command]
pub fn worktree_prune(db: State<'_, Db>, project_id: String) -> AppResult<()> {
    let project = db.get_project(&project_id)?;
    worktree::prune(Path::new(&project.path))
}
