APP_DIR := apps/archivist-tauri
TAURI_DIR := $(APP_DIR)/src-tauri

.PHONY: setup dev build clean install lint

## setup: Install frontend dependencies
setup:
	cd $(APP_DIR) && npm install

## dev: Start the app in development mode
dev:
	cd $(APP_DIR) && npm run tauri dev

## build: Build the production app bundle
build:
	cd $(APP_DIR) && npm run tauri build

## clean: Remove build artifacts
clean:
	rm -rf $(APP_DIR)/dist
	cd $(TAURI_DIR) && cargo clean

## install: Setup + build
install: setup build

## lint: Run cargo check on the Rust side
lint:
	cd $(TAURI_DIR) && cargo clippy -- -D warnings

help: ## Show this help
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## //'
