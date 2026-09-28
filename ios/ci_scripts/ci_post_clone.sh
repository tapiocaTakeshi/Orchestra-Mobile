#!/bin/bash
#
# Xcode Cloud がリポジトリを clone した直後に実行するスクリプト。
#
# このアプリは Expo の managed workflow なので ios/ はコミットしていない。
# ここで毎回 `expo prebuild` して Xcode プロジェクトを作り、pod install まで済ませる。
# Xcode Cloud のワークフローには ios/OrchestraMobile.xcworkspace とスキーム
# OrchestraMobile を指定する (ci_scripts はワークスペースと同じ ios/ に置く決まり)。
#
# ワークフローの環境変数:
#   APPLE_TEAM_ID  (必須) 署名に使う Apple Developer のチーム ID
#   NODE_FORMULA   (任意) Homebrew の Node のフォーミュラ。既定は node@22
#
# ビルド番号には Xcode Cloud の CI_BUILD_NUMBER をそのまま使う。

set -euo pipefail

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
NODE_FORMULA="${NODE_FORMULA:-node@22}"

if [ -z "${APPLE_TEAM_ID:-}" ]; then
	echo "error: APPLE_TEAM_ID が未設定です。Xcode Cloud のワークフローの Environment に追加してください。" >&2
	exit 1
fi

export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_ENV_HINTS=1

echo "==> Node ($NODE_FORMULA) を用意"
brew install "$NODE_FORMULA"
# node@XX は keg-only なので PATH に自分で足す。
export PATH="$(brew --prefix "$NODE_FORMULA")/bin:$PATH"
node --version
npm --version

if ! command -v pod >/dev/null 2>&1; then
	echo "==> CocoaPods を用意"
	brew install cocoapods
fi
pod --version

cd "$REPO_ROOT"

echo "==> npm ci"
npm ci

echo "==> expo prebuild (iOS)"
# ios/ に ci_scripts しか無いと prebuild は「壊れたプロジェクト」とみなして ios/ ごと作り直す。
# 後続の ci_pre_xcodebuild.sh などを Xcode Cloud が探せるよう、退避して戻す。
SCRIPTS_BACKUP="$(mktemp -d)"
cp -R "$REPO_ROOT/ios/ci_scripts" "$SCRIPTS_BACKUP/"
# --no-install: pod install は下で明示的に行う (失敗箇所をログで追いやすくするため)。
# CI=1: Expo CLI に対話プロンプトを出させない。
CI=1 APPLE_TEAM_ID="$APPLE_TEAM_ID" IOS_BUILD_NUMBER="${CI_BUILD_NUMBER:-}" \
	npx expo prebuild --platform ios --no-install
rm -rf "$REPO_ROOT/ios/ci_scripts"
cp -R "$SCRIPTS_BACKUP/ci_scripts" "$REPO_ROOT/ios/"
rm -rf "$SCRIPTS_BACKUP"

cd "$REPO_ROOT/ios"

# xcodebuild の「Bundle React Native code and images」は .xcode.env(.local) の
# NODE_BINARY で Node を探す。ビルド時の PATH には keg-only の Node が無いので、絶対パスで固定する。
echo "export NODE_BINARY=$(command -v node)" > .xcode.env.local

echo "==> pod install"
pod install

echo "==> 準備完了: $(ls -d ./*.xcworkspace)"
