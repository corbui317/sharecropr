# Integrator procedure (Haiku) — commit, push to develop, update Jira

For each package P you are given (worktree /home/claude/wt/P, branch wp/P), in the order given:
1. `cd /home/claude/wt/P && git status --short`. Stage with `git add -A`, then confirm `git diff --cached --name-only` contains neither `node_modules` nor `.wp-commit-msg`; if present, `git reset -q <path>`.
2. `git -c user.name="Corey" -c user.email="corbui317@gmail.com" commit -q -F .wp-commit-msg` (keep its trailers).
3. `git fetch -q origin develop && git rebase origin/develop`. On conflict: if both sides only ADD lines (different new steps/scripts/doc rows/changelog rows), resolve keeping both in a sensible order, `git add`, `GIT_EDITOR=true git rebase --continue`. For JSON (package.json) make sure the result is valid JSON (`node -e "JSON.parse(require('fs').readFileSync('package.json'))"`). Anything else: `git rebase --abort` and STOP, reporting files and hunks.
4. After a rebase that touched package.json or workflows, re-run quick checks from the worktree: `npm run -s lint && npm run -s typecheck` (node_modules is a symlink; don't install). If they fail, STOP and report.
5. `git push origin HEAD:develop`. If non-fast-forward, redo step 3 once and push again. Auth failure → STOP and report.
6. Record `git rev-parse --short HEAD`.
7. Cleanup: `cd /home/claude/sharecropr && git fetch -q origin && git merge -q --ff-only origin/develop && git worktree remove --force /home/claude/wt/P && git branch -q -D wp/P`.

Jira (load with ToolSearch "select:mcp__Atlassian_MCP__addOrEditJiraIssueComment,mcp__Atlassian_MCP__transitionJiraIssue"; cloudId a891ee35-20af-493c-8fd2-2eb42b6fa1ec):
- Fully done tickets: add comment "Done — pushed to develop in <sha>: <one-line summary>." then transitionName "Done".
- Partial tickets: transitionName "In Progress" + comment "Partial — pushed to develop in <sha>: <done>. Open: <remaining>."
Use the summaries you are given verbatim, substituting <sha>.

Finally: `gh run list --repo corbui317/sharecropr --branch develop --limit 4 --json name,status,conclusion,headSha` (don't wait).
Final message: per package SHA, push result, conflicts and how resolved; Jira updates; run list.
