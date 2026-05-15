#!/usr/bin/env bash
# Local installer for oh-my-opendevin
# This script installs the oh-my-opendevin fork locally via symlink.
# No npm publish required - runs directly from the repository.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Detect the appropriate shell rc file based on $SHELL
detect_shell_rc() {
  local shell_name=""
  if [[ -n "${SHELL:-}" ]]; then
    shell_name=$(basename "$SHELL")
  fi
  case "$shell_name" in
    zsh)
      if [[ -f "$HOME/.zshrc" ]]; then
        echo "$HOME/.zshrc"
      elif [[ -f "$HOME/.zprofile" ]]; then
        echo "$HOME/.zprofile"
      else
        echo "$HOME/.zshrc"
      fi
      ;;
    bash)
      if [[ -f "$HOME/.bashrc" ]]; then
        echo "$HOME/.bashrc"
      elif [[ -f "$HOME/.bash_profile" ]]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    *)
      if [[ -f "$HOME/.zshrc" ]]; then
        echo "$HOME/.zshrc"
      elif [[ -f "$HOME/.bashrc" ]]; then
        echo "$HOME/.bashrc"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
  esac
}

# Install Bun if not present
install_bun() {
  log_info "Installing Bun..."

  # Check if curl is available
  if ! command -v curl &> /dev/null; then
    log_error "curl is required to install Bun but is not installed"
    return 1
  fi

  # Install Bun using the official installer
  # The installer automatically handles PATH setup
  if curl -fsSL https://bun.sh/install | bash; then
    # The bun installer adds itself to PATH in shell config files
    # We need to use the direct path for this session
    BUN_INSTALL_DIR="$HOME/.bun/bin"

    if [[ -d "$BUN_INSTALL_DIR" ]]; then
      export PATH="$BUN_INSTALL_DIR:$PATH"

      if command -v bun &> /dev/null; then
        log_success "Bun installed successfully: $(bun --version)"
        return 0
      else
        log_error "Bun installation completed but command not found at $BUN_INSTALL_DIR/bun"
        return 1
      fi
    else
      log_error "Bun installation directory not found at $BUN_INSTALL_DIR"
      return 1
    fi
  else
    log_error "Failed to install Bun via curl"
    return 1
  fi
}

# Parse args
DO_UNINSTALL=false
DO_VERIFY=true
DO_HELP=false
DO_FIX_MCP=false
DO_RESTORE=false
for arg in "$@"; do
  case $arg in
    --uninstall) DO_UNINSTALL=true ;;
    --no-verify) DO_VERIFY=false ;;
    --fix-mcp) DO_FIX_MCP=true ;;
    --restore) DO_RESTORE=true ;;
    --help) DO_HELP=true ;;
    *) log_error "Unknown option: $arg"; exit 1 ;;
  esac
done

if [[ "$DO_HELP" == true ]]; then
  echo "Usage: $0 [--uninstall] [--no-verify] [--fix-mcp] [--restore] [--help]"
  echo "  --uninstall   Remove local installation and backup configs"
  echo "  --no-verify   Skip verification step"
  echo "  --fix-mcp     Fix MCP configuration without reinstalling"
  echo "  --restore     Restore configs from last backup"
  echo "  --help        Show this help"
  exit 0
fi

# Backup directory
BACKUP_DIR="$HOME/.config/opencode/oh-my-opendevin-backups"

# Handle restore
if [[ "$DO_RESTORE" == true ]]; then
  if [[ ! -d "$BACKUP_DIR" ]]; then
    log_error "No backup directory found at $BACKUP_DIR"
    log_info "There are no backups to restore."
    exit 1
  fi

  # Find the most recent backup
  LATEST_BACKUP=$(ls -1t "$BACKUP_DIR" 2>/dev/null | head -n1)
  if [[ -z "$LATEST_BACKUP" ]]; then
    log_error "No backups found in $BACKUP_DIR"
    exit 1
  fi

  RESTORE_FROM="$BACKUP_DIR/$LATEST_BACKUP"
  log_info "Restoring from backup: $LATEST_BACKUP"

  # Restore MCP config (claude-code-mcp-loader reads from ~/.claude/.mcp.json)
  if [[ -f "$RESTORE_FROM/.mcp.json" ]]; then
    mkdir -p "$HOME/.claude"
    cp "$RESTORE_FROM/.mcp.json" "$HOME/.claude/.mcp.json"
    log_success "Restored MCP configuration"
  fi

  # Restore MCP launcher
  if [[ -f "$RESTORE_FROM/devin-mcp-launcher.sh" ]]; then
    cp "$RESTORE_FROM/devin-mcp-launcher.sh" "$HOME/.config/opencode/devin-mcp-launcher.sh"
    chmod +x "$HOME/.config/opencode/devin-mcp-launcher.sh"
    log_success "Restored MCP launcher"
  fi

  # Restore OpenCode config
  if [[ -f "$RESTORE_FROM/opencode.json" ]]; then
    cp "$RESTORE_FROM/opencode.json" "$HOME/.config/opencode/opencode.json"
    log_success "Restored OpenCode configuration"
  elif [[ -f "$RESTORE_FROM/opencode.jsonc" ]]; then
    cp "$RESTORE_FROM/opencode.jsonc" "$HOME/.config/opencode/opencode.jsonc"
    log_success "Restored OpenCode configuration"
  fi

  log_success "Restore complete! Restart OpenCode."
  log_info "Backup preserved at: $RESTORE_FROM"
  exit 0
fi

# Handle uninstall
if [[ "${DO_UNINSTALL:-false}" == true ]]; then
  log_info "Uninstalling oh-my-opendevin..."

  # Create backup before removing anything
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  CURRENT_BACKUP="$BACKUP_DIR/$TIMESTAMP"
  mkdir -p "$CURRENT_BACKUP"
  log_info "Creating backup at $CURRENT_BACKUP..."

  # Backup MCP config (claude-code-mcp-loader reads from ~/.claude/.mcp.json)
  USER_MCP_CONFIG="$HOME/.claude/.mcp.json"
  if [[ -f "$USER_MCP_CONFIG" ]]; then
    cp "$USER_MCP_CONFIG" "$CURRENT_BACKUP/.mcp.json"
    log_success "Backed up MCP configuration"
  fi

  # Backup MCP launcher
  MCP_LAUNCHER="$HOME/.config/opencode/devin-mcp-launcher.sh"
  if [[ -f "$MCP_LAUNCHER" ]]; then
    cp "$MCP_LAUNCHER" "$CURRENT_BACKUP/devin-mcp-launcher.sh"
    log_success "Backed up MCP launcher"
  fi

  # Backup OpenCode config
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
  if [[ ! -f "$OPENCODE_CONFIG" ]]; then
    OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
  fi
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    cp "$OPENCODE_CONFIG" "$CURRENT_BACKUP/$(basename "$OPENCODE_CONFIG")"
    log_success "Backed up OpenCode configuration"
  fi

  echo ""

  # Remove symlinks
  GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
  GLOBAL_BIN_DIR="$HOME/.npm-global/bin"

  if [[ -L "$GLOBAL_MODULE_DIR/oh-my-opendevin" ]]; then
    rm "$GLOBAL_MODULE_DIR/oh-my-opendevin"
    log_success "Removed module symlink"
  fi

  if [[ -L "$GLOBAL_BIN_DIR/oh-my-opendevin" ]]; then
    rm "$GLOBAL_BIN_DIR/oh-my-opendevin"
    log_success "Removed binary symlink"
  fi

  if [[ -L "$GLOBAL_BIN_DIR/oh-my-opencode" ]]; then
    rm "$GLOBAL_BIN_DIR/oh-my-opencode"
    log_success "Removed oh-my-opencode binary symlink"
  fi

  OPENCODE_MODULE_DIR="$HOME/.config/opencode/node_modules"
  if [[ -L "$OPENCODE_MODULE_DIR/oh-my-opendevin" ]]; then
    rm "$OPENCODE_MODULE_DIR/oh-my-opendevin"
    log_success "Removed OpenCode node_modules symlink"
  fi

  # Remove user-level MCP configuration and launcher
  if [[ -f "$USER_MCP_CONFIG" ]]; then
    if command -v jq &> /dev/null; then
      jq 'del(.mcpServers.devin)' "$USER_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$USER_MCP_CONFIG"
      log_success "Removed Devin MCP from user-level configuration"
    else
      log_warn "jq not found. Please manually remove Devin MCP from $USER_MCP_CONFIG"
    fi
  fi

  # Also clean up old legacy location if present
  OLD_MCP_CONFIG="$HOME/.config/opencode/.mcp.json"
  if [[ -f "$OLD_MCP_CONFIG" ]]; then
    if command -v jq &> /dev/null; then
      jq 'del(.mcpServers.devin)' "$OLD_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$OLD_MCP_CONFIG"
      log_success "Removed Devin MCP from legacy config location"
    else
      log_warn "jq not found. Please manually remove Devin MCP from $OLD_MCP_CONFIG"
    fi
  fi

  # Remove MCP launcher
  if [[ -f "$MCP_LAUNCHER" ]]; then
    rm "$MCP_LAUNCHER"
    log_success "Removed MCP launcher"
  fi

  # Remove from OpenCode config
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    if command -v jq &> /dev/null; then
      REPO_PATH="$(pwd)"
      jq 'del(.plugin[] | select(. == "oh-my-opendevin" or . == "oh-my-openagent" or . == "oh-my-opencode" or startswith("file://")))' \
        "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
        mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
      log_success "Removed from OpenCode config"
    else
      log_warn "jq not found. Please manually remove oh-my-opendevin from $OPENCODE_CONFIG"
    fi
  fi

  # Remove from OpenCode package.json
  OPENCODE_PKG_JSON="$HOME/.config/opencode/package.json"
  if [[ -f "$OPENCODE_PKG_JSON" ]]; then
    if command -v jq &> /dev/null; then
      jq 'del(.dependencies["oh-my-opendevin"])' "$OPENCODE_PKG_JSON" > /tmp/opencode-pkg.json.tmp && \
        mv /tmp/opencode-pkg.json.tmp "$OPENCODE_PKG_JSON"
      log_success "Removed from OpenCode package.json"
    else
      log_warn "jq not found. Please manually remove oh-my-opendevin from $OPENCODE_PKG_JSON"
    fi
  fi

  echo ""
  log_success "Uninstall complete!"
  log_info "Configs backed up to: $CURRENT_BACKUP"
  log_info "To restore later, run:"
  echo "  $0 --restore"
  log_info "Or reinstall to reconfigure from scratch."
  echo ""
  log_info "Restart OpenCode to unload the plugin."
  exit 0
fi

# Handle --fix-mcp (standalone MCP repair without full reinstall)
if [[ "$DO_FIX_MCP" == true ]]; then
  log_info "Running MCP configuration fix..."

  # Check Bun
  if ! command -v bun &> /dev/null; then
    log_warn "Bun not found. MCP requires Bun."
    log_info "Installing Bun automatically..."
    if ! install_bun; then
      log_error "Failed to install Bun. Cannot fix MCP without Bun."
      exit 1
    fi
  fi
  log_success "Bun available: $(bun --version)"

  # Find the launcher in the local repository
  LAUNCHER_SOURCE=""
  if [[ -f "bin/devin-mcp-launcher.sh" ]]; then
    LAUNCHER_SOURCE="$(pwd)/bin/devin-mcp-launcher.sh"
  else
    # Try to find from the existing global symlink
    GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
    if [[ -L "$GLOBAL_MODULE_DIR/oh-my-opendevin" ]]; then
      LAUNCHER_SOURCE="$(readlink -f "$GLOBAL_MODULE_DIR/oh-my-opendevin")/bin/devin-mcp-launcher.sh"
    fi
  fi

  if [[ -z "$LAUNCHER_SOURCE" ]] || [[ ! -f "$LAUNCHER_SOURCE" ]]; then
    log_error "MCP launcher not found."
    log_info "Please run this script from the repository root or ensure the module symlink exists."
    exit 1
  fi

  USER_MCP_CONFIG="$HOME/.claude/.mcp.json"
  mkdir -p "$(dirname "$USER_MCP_CONFIG")"

  # Also clean up old legacy location
  OLD_MCP_CONFIG="$HOME/.config/opencode/.mcp.json"
  if [[ -f "$OLD_MCP_CONFIG" ]]; then
    if command -v jq &> /dev/null; then
      jq 'del(.mcpServers.devin)' "$OLD_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$OLD_MCP_CONFIG"
      log_info "Cleaned up legacy MCP config at $OLD_MCP_CONFIG"
    fi
  fi

  # Install launcher
  MCP_LAUNCHER="$HOME/.config/opencode/devin-mcp-launcher.sh"
  cp "$LAUNCHER_SOURCE" "$MCP_LAUNCHER"
  chmod +x "$MCP_LAUNCHER"
  log_success "Installed MCP launcher"

  # Check for old hardcoded-path configs
  NEEDS_FIX=false
  if [[ -f "$USER_MCP_CONFIG" ]]; then
    if grep -qE '"command":\s*"bun"' "$USER_MCP_CONFIG" 2>/dev/null; then
      NEEDS_FIX=true
      log_warn "Detected old hardcoded-path MCP config"
    fi
  fi

  # Write/Update MCP config
  if command -v jq &> /dev/null; then
    if [[ -f "$USER_MCP_CONFIG" ]]; then
      jq --arg launcher "$MCP_LAUNCHER" '.mcpServers.devin = {
        "type": "stdio",
        "command": "bash",
        "args": [$launcher],
        "env": {}
      }' "$USER_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$USER_MCP_CONFIG"
    else
      cat > "$USER_MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "devin": {
      "type": "stdio",
      "command": "bash",
      "args": ["$MCP_LAUNCHER"],
      "env": {}
    }
  }
}
EOF
    fi
    log_success "MCP configuration updated"
  else
    log_warn "jq not found. Writing config directly..."
    cat > "$USER_MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "devin": {
      "type": "stdio",
      "command": "bash",
      "args": ["$MCP_LAUNCHER"],
      "env": {}
    }
  }
}
EOF
    log_success "MCP configuration created"
  fi

  # Smoke test
  log_info "Testing MCP server startup..."
  SMOKE_OUTPUT=$(
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"fix","version":"1.0"}}}' \
      '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' |
    timeout 5 bash "$MCP_LAUNCHER" 2>/dev/null | grep -o '"devin_start"' | head -1 || true
  )

  if [[ "$SMOKE_OUTPUT" == '"devin_start"' ]]; then
    log_success "MCP server starts correctly"
  else
    log_warn "MCP server test had issues"
  fi

  echo ""
  log_success "MCP fix complete!"
  log_info "Restart OpenCode to reload MCP servers."
  exit 0
fi

# Step 1: Check prerequisites
log_info "Step 1: Checking prerequisites..."

# Check for bun (required for build and MCP integration)
if command -v bun &> /dev/null; then
  log_success "bun found: $(bun --version)"
else
  log_warn "bun not found (required for build and MCP integration)"
  log_info "Installing Bun automatically..."
  if ! install_bun; then
    log_error "Failed to install Bun. Cannot proceed without Bun."
    log_info "You can install Bun manually from https://bun.sh/"
    exit 1
  fi
fi

# Step 2: Install locally via symlink
log_info "Step 2: Installing oh-my-opendevin locally..."

# Check if we're in the repository
if [[ -f "package.json" ]] && [[ -f "src/index.ts" ]]; then
  log_info "Installing from local repository..."

  # Install dependencies if missing
  if [[ ! -d "node_modules" ]]; then
    log_info "node_modules not found. Installing dependencies..."
    if bun install > /dev/null 2>&1; then
      log_success "Dependencies installed"
    else
      log_error "Failed to install dependencies"
      bun install
      exit 1
    fi
  fi

  # Build the project
  log_info "Building project..."
  if bun run build > /dev/null 2>&1; then
    log_success "Build successful"
  else
    log_error "Build failed"
    bun run build
    exit 1
  fi

  # Create global symlinks
  log_info "Creating global symlinks..."

  GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
  GLOBAL_BIN_DIR="$HOME/.npm-global/bin"

  # Create directories
  mkdir -p "$GLOBAL_MODULE_DIR"
  mkdir -p "$GLOBAL_BIN_DIR"

  # Create symlink to the repo root (not dist/) so require("oh-my-opendevin")
  # resolves package.json and dist/ correctly.
  ln -sf "$(pwd)" "$GLOBAL_MODULE_DIR/oh-my-opendevin"

  # Also symlink into OpenCode's node_modules so the Electron runtime can find it
  OPENCODE_MODULE_DIR="$HOME/.config/opencode/node_modules"
  mkdir -p "$OPENCODE_MODULE_DIR"
  ln -sf "$(pwd)" "$OPENCODE_MODULE_DIR/oh-my-opendevin"

  # Create symlink for the binary
  ln -sf "$(pwd)/bin/oh-my-opencode.js" "$GLOBAL_BIN_DIR/oh-my-opendevin"
  ln -sf "$(pwd)/bin/oh-my-opencode.js" "$GLOBAL_BIN_DIR/oh-my-opencode"

  # Register in OpenCode's package.json so its package manager resolves the plugin
  OPENCODE_PKG_JSON="$HOME/.config/opencode/package.json"
  if [[ -f "$OPENCODE_PKG_JSON" ]]; then
    if command -v jq &> /dev/null; then
      if ! jq -e '.dependencies["oh-my-opendevin"]' "$OPENCODE_PKG_JSON" &>/dev/null; then
        jq '.dependencies["oh-my-opendevin"] = "file://'"$(pwd)"'"' "$OPENCODE_PKG_JSON" > /tmp/opencode-pkg.json.tmp && \
          mv /tmp/opencode-pkg.json.tmp "$OPENCODE_PKG_JSON"
        log_success "Added oh-my-opendevin to OpenCode package.json"
      else
        log_info "oh-my-opendevin already in OpenCode package.json"
      fi
    else
      log_warn "jq not found. Please manually add oh-my-opendevin to $OPENCODE_PKG_JSON"
    fi
  else
    mkdir -p "$HOME/.config/opencode"
    cat > "$OPENCODE_PKG_JSON" <<EOF
{
  "dependencies": {
    "@opencode-ai/plugin": "1.14.51",
    "oh-my-opendevin": "file://$(pwd)"
  }
}
EOF
    log_success "Created OpenCode package.json with oh-my-opendevin"
  fi

  # Add to PATH if not already there
  if [[ ":$PATH:" != *":$GLOBAL_BIN_DIR:"* ]]; then
    log_warn "Adding $GLOBAL_BIN_DIR to PATH"
    SHELL_RC=$(detect_shell_rc)
    echo "export PATH=\"$GLOBAL_BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    export PATH="$GLOBAL_BIN_DIR:$PATH"
    log_info "Updated PATH in $SHELL_RC"
    # Source the rc file so the current shell picks up the change immediately,
    # but only if it's compatible with the running shell interpreter
    if [[ -f "$SHELL_RC" ]]; then
      if [[ -n "${BASH_VERSION:-}" && "$SHELL_RC" == *bash* ]]; then
        # shellcheck source=/dev/null
        source "$SHELL_RC" 2>/dev/null || true
      elif [[ -n "${ZSH_VERSION:-}" && "$SHELL_RC" == *zsh* ]]; then
        # shellcheck source=/dev/null
        source "$SHELL_RC" 2>/dev/null || true
      fi
    fi
  fi

  log_success "Local installation complete via symlink"
else
  log_error "Not in repository directory"
  log_error "Please run this script from the repository root"
  exit 1
fi

# Step 3: Verify installation
log_info "Step 3: Verifying installation..."

if command -v oh-my-opendevin &> /dev/null; then
  log_success "CLI command available: oh-my-opendevin"
elif command -v oh-my-opencode &> /dev/null; then
  log_success "CLI command available: oh-my-opencode"
else
  log_warn "CLI command not found in PATH (may need to restart shell)"
fi

# Check if symlink exists
GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
if [[ -L "$GLOBAL_MODULE_DIR/oh-my-opendevin" ]]; then
  log_success "Package verified as local symlink"
else
  log_error "Symlink not found at $GLOBAL_MODULE_DIR/oh-my-opendevin"
  exit 1
fi

# Step 4: Configure MCP servers
log_info "Step 4: Configuring MCP servers..."

# Install the MCP launcher to a stable location
log_info "Installing MCP launcher..."

# Find the launcher in the local repository
LAUNCHER_SOURCE=""
if [[ -f "bin/devin-mcp-launcher.sh" ]]; then
  LAUNCHER_SOURCE="$(pwd)/bin/devin-mcp-launcher.sh"
fi

USER_MCP_CONFIG="$HOME/.claude/.mcp.json"
mkdir -p "$(dirname "$USER_MCP_CONFIG")"

# Clean up old legacy location so the plugin doesn't read stale config
OLD_MCP_CONFIG="$HOME/.config/opencode/.mcp.json"
if [[ -f "$OLD_MCP_CONFIG" ]]; then
  if command -v jq &> /dev/null; then
    jq 'del(.mcpServers.devin)' "$OLD_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$OLD_MCP_CONFIG"
    log_info "Cleaned up legacy MCP config at $OLD_MCP_CONFIG"
  fi
fi

if [[ -n "$LAUNCHER_SOURCE" ]] && [[ -f "$LAUNCHER_SOURCE" ]]; then
  # Copy launcher to stable location
  MCP_LAUNCHER="$HOME/.config/opencode/devin-mcp-launcher.sh"
  cp "$LAUNCHER_SOURCE" "$MCP_LAUNCHER"
  chmod +x "$MCP_LAUNCHER"
  log_success "Installed MCP launcher to $MCP_LAUNCHER"

  if [[ ! -f "$USER_MCP_CONFIG" ]]; then
    log_info "Creating user-level MCP configuration..."

    cat > "$USER_MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "devin": {
      "type": "stdio",
      "command": "bash",
      "args": ["$MCP_LAUNCHER"],
      "env": {}
    }
  }
}
EOF

    log_success "Created user-level MCP configuration"
  else
    log_info "Updating existing user-level MCP configuration..."

    if command -v jq &> /dev/null; then
      jq --arg launcher "$MCP_LAUNCHER" '.mcpServers.devin = {
        "type": "stdio",
        "command": "bash",
        "args": [$launcher],
        "env": {}
      }' "$USER_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$USER_MCP_CONFIG"
      log_success "Updated user-level MCP configuration"
    else
      log_warn "jq not found. Please manually update Devin MCP in $USER_MCP_CONFIG"
      log_warn "Set devin server to:"
      echo "  {"
      echo "    \"type\": \"stdio\","
      echo "    \"command\": \"bash\","
      echo "    \"args\": [\"$MCP_LAUNCHER\"],"
      echo "    \"env\": {}"
      echo "  }"
    fi
  fi
else
  log_warn "MCP launcher not found in repository. MCP configuration may not work correctly."
  log_info "If MCP tools don't appear, run: ./install-global.sh --fix-mcp"
fi

# Smoke test the MCP server after configuration
if [[ -f "$MCP_LAUNCHER" ]] && [[ -x "$MCP_LAUNCHER" ]]; then
  log_info "Testing MCP server startup..."
  smoke_output=$(
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"install","version":"1.0"}}}' \
      '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' |
    timeout 5 bash "$MCP_LAUNCHER" 2>/dev/null | grep -o '"devin_start"' | head -1 || true
  )

  if [[ "$smoke_output" == '"devin_start"' ]]; then
    log_success "MCP server smoke test passed"
  else
    log_warn "MCP server smoke test failed"
    log_info "Devin tools may not appear in OpenCode. Try: ./install-global.sh --fix-mcp"
  fi
fi

# Step 5: Configure OpenCode
log_info "Step 5: Configuring OpenCode..."

OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
fi

REPO_PATH="$(pwd)"
FILE_PLUGIN_ENTRY="file://${REPO_PATH}"

if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  log_warn "OpenCode config not found at ~/.config/opencode/opencode.json or opencode.jsonc"
  log_info "Creating new config file..."
  mkdir -p "$HOME/.config/opencode"
  echo "{\"plugin\": [\"${FILE_PLUGIN_ENTRY}\"]}" > "$OPENCODE_CONFIG"
  log_success "Created new OpenCode config"
else
  if command -v jq &> /dev/null; then
    # Ensure .plugin is an array, remove old bare-name and file:// entries,
    # then add the current file:// entry — all in one jq pass.
    jq --arg entry "$FILE_PLUGIN_ENTRY" '.plugin //= []
      | .plugin |= map(select(. != "oh-my-openagent" and . != "oh-my-opencode" and . != "oh-my-opendevin" and (. | startswith("file://") | not)))
      | .plugin |= if any(.[]; . == $entry) then . else [$entry] + . end' \
      "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
      mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"

    log_success "Updated OpenCode config"
  else
    log_warn "jq not found. Please manually edit $OPENCODE_CONFIG"
    log_warn "Add \"${FILE_PLUGIN_ENTRY}\" to the plugin array"
    log_warn 'Remove any existing "oh-my-openagent", "oh-my-opencode", or old file:// entries to avoid conflicts'
  fi
fi

# Step 6: Verification (optional)
if [[ "$DO_VERIFY" == true ]]; then
  log_info "Step 6: Running verification..."

  if command -v oh-my-opendevin &> /dev/null; then
    if oh-my-opendevin doctor &> /tmp/omo-doctor.log 2>&1; then
      log_success "Doctor check passed"
    else
      log_warn "Doctor check had issues. Check /tmp/omo-doctor.log for details"
    fi
  elif command -v oh-my-opencode &> /dev/null; then
    if oh-my-opencode doctor &> /tmp/omo-doctor.log 2>&1; then
      log_success "Doctor check passed"
    else
      log_warn "Doctor check had issues. Check /tmp/omo-doctor.log for details"
    fi
  else
    log_warn "CLI command not available, skipping doctor check"
  fi
fi

# Step 6: Instructions
log_success "Installation complete!"
echo ""
log_info "Next steps:"
echo "  1. Restart OpenCode to load the plugin"
echo "  2. Run ./check-installation.sh to verify all components"
echo "  3. Verify by checking for OmO agent availability"
echo ""
log_info "CLI commands available:"
echo "  - oh-my-opendevin (or oh-my-opencode)"
echo "  - oh-my-opendevin doctor"
echo "  - oh-my-opendevin install"
echo ""
log_info "Verification & Repair:"
echo "  - ./check-installation.sh          # Quick diagnostic"
echo "  - ./install-global.sh --fix-mcp    # Fix MCP if tools don't appear"
echo ""
log_info "To uninstall:"
echo "  ./install-global.sh --uninstall"
echo ""
log_info "Documentation:"
echo "  https://github.com/fredotran/oh-my-opendevin"
