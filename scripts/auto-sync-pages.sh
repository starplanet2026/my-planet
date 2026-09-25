#!/bin/bash
# ================================================================
# 我的星球 GitHub Pages 自动同步推送脚本
# 功能：监测本地代码改动，自动 commit + push，触发 GitHub Pages 部署
# 用法：bash scripts/auto-sync-pages.sh
# ================================================================

set -u

# 确保基础命令可用
export PATH="/bin:/usr/bin:/usr/local/bin:$PATH"

# ---------- 配置 ----------
GIT="/usr/bin/git"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && /bin/pwd)"
POLL_INTERVAL=15        # 轮询间隔（秒）：多久检查一次是否有改动
DEBOUNCE_SECONDS=20     # 防抖秒数：检测到改动后等待多久不再有新改动才提交
COMMIT_AUTHOR="starplanet2026 <starplanet2026@users.noreply.github.com>"
LOG_FILE="$PROJECT_DIR/scripts/auto-sync.log"

# 远程地址（用于提示）
REMOTE_URL="https://github.com/starplanet2026/my-planet.git"
PAGES_URL="https://starplanet2026.github.io/my-planet/"

cd "$PROJECT_DIR" || exit 1

# 日志函数：同时输出到终端和日志文件
log() {
  local ts
  ts="$(/bin/date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

# 执行 git 命令时强制不走代理（直连 GitHub）
git_noproxy() {
  "$GIT" -c http.proxy= -c https.proxy= "$@"
}

# 生成提交信息：基于 diff 统计
generate_commit_msg() {
  local stat
  stat="$("$GIT" diff --cached --stat | /usr/bin/tail -1)"
  local files
  files="$("$GIT" diff --cached --name-only | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
  local summary
  summary="$("$GIT" diff --cached --name-only | /usr/bin/head -15 | /usr/bin/sed 's/^/  - /' | /usr/bin/tr '\n' ' ')"
  echo "auto-sync: ${files} files changed (${stat})

${summary}"
}

# 主循环
log "=========================================="
log "自动同步脚本启动"
log "项目目录: $PROJECT_DIR"
log "远程仓库: $REMOTE_URL"
log "线上地址: $PAGES_URL"
log "轮询间隔: ${POLL_INTERVAL}s | 防抖: ${DEBOUNCE_SECONDS}s"
log "=========================================="

last_change_time=0

while true; do
  # 检查是否有未提交改动
  if ! "$GIT" diff --quiet 2>/dev/null || ! "$GIT" diff --cached --quiet 2>/dev/null || [ -n "$("$GIT" ls-files --others --exclude-standard)" ]; then

    now="$(/bin/date +%s)"

    # 首次检测到改动，记录时间
    if [ "$last_change_time" -eq 0 ]; then
      last_change_time="$now"
      log "检测到代码改动，等待 ${DEBOUNCE_SECONDS}s 防抖..."
    fi

    elapsed=$(( now - last_change_time ))

    # 防抖：等待 DEBOUNCE_SECONDS 内没有新改动才提交
    if [ "$elapsed" -ge "$DEBOUNCE_SECONDS" ]; then
      log "防抖结束，开始提交推送..."

      # ① 检索全部变更文件
      change_list="$("$GIT" status --short)"
      change_count="$(echo "$change_list" | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
      log "本次改动清单（${change_count} 个文件）："
      echo "$change_list" | while IFS= read -r line; do log "  $line"; done

      # ② 暂存全部改动
      "$GIT" add -A
      if [ $? -ne 0 ]; then
        log "❌ git add 失败！停止自动流程。"
        log "手动执行命令："
        log "  cd \"$PROJECT_DIR\""
        log "  /usr/bin/git add -A"
        last_change_time=0
        sleep "$POLL_INTERVAL"
        continue
      fi

      # ③ 生成提交信息并提交
      commit_msg="$(generate_commit_msg)"
      "$GIT" commit -m "$commit_msg" --author="$COMMIT_AUTHOR" 2>&1
      commit_rc=$?
      if [ $commit_rc -ne 0 ]; then
        log "❌ git commit 失败（exit=$commit_rc）！停止自动流程。"
        log "手动执行命令："
        log "  cd \"$PROJECT_DIR\""
        log "  /usr/bin/git add -A"
        log "  /usr/bin/git commit -m \"你的提交说明\""
        log "  /usr/bin/git -c http.proxy= -c https.proxy= push origin main"
        last_change_time=0
        sleep "$POLL_INTERVAL"
        continue
      fi

      commit_hash="$("$GIT" rev-parse --short HEAD)"
      log "✅ 提交成功: $commit_hash"

      # ④ 推送到远程
      push_output="$(git_noproxy push origin main 2>&1)"
      push_rc=$?
      if [ $push_rc -ne 0 ]; then
        log "❌ git push 失败（exit=$push_rc）！"
        log "错误输出："
        echo "$push_output" | while IFS= read -r line; do log "  $line"; done
        log "手动执行命令："
        log "  cd \"$PROJECT_DIR\""
        log "  /usr/bin/git -c http.proxy= -c https.proxy= push origin main"
        last_change_time=0
        sleep "$POLL_INTERVAL"
        continue
      fi

      log "✅ 推送成功！"
      echo "$push_output" | while IFS= read -r line; do log "  $line"; done
      log "🚀 GitHub Pages 部署已触发，预计 1~3 分钟后上线"
      log "🌐 线上地址: $PAGES_URL"
      log "💡 预览请使用无痕窗口或强制刷新(Cmd+Shift+R)清除浏览器缓存"

      last_change_time=0
    fi
  else
    # 无改动，重置防抖计时
    if [ "$last_change_time" -ne 0 ]; then
      log "改动已撤回/无变化，重置防抖计时"
      last_change_time=0
    fi
  fi

  sleep "$POLL_INTERVAL"
done
