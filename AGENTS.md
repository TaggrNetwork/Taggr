# AI Agent Project Guide: taggr

This document provides a technical overview of the `taggr` project for the AI agent. It covers the architecture, development workflows, and key components.

## 1. Project Overview

Taggr is a fully decentralized social media platform built on the Internet Computer. It combines features of forums and blogs, operating on a token-based economic model where users own and govern the platform. Revenue is generated through user interactions (credits) and shared with content creators and token holders, eliminating the need for ads.

**Core Concepts:**

-   **Credits:** Used by users to pay for actions like posting and reacting.
-   **Tokens ($token_symbol):** Grant governance rights and a share of platform revenue.
-   **Realms:** Topic-based communities with their own rules.
-   **Stalwarts:** Trusted, high-stake users who perform moderation.
-   **Governance:** The platform is upgraded and managed via user-submitted proposals.

## 2. Tech Stack

-   **Backend:** Rust
-   **Frontend:** React & TypeScript
-   **Blockchain:** Internet Computer
-   **Build Tools:** Webpack, Cargo
-   **Testing:**
    -   **E2E:** Playwright
    -   **Integration (Backend):** PocketIC
-   **Deployment:** `dfx` CLI

## 3. Key Architectural Components

### Memory Management
- Custom allocator system using stable memory for persistent storage
- ObjectManager for serializing/deserializing objects to/from stable memory
- Memory growth and management handled through stable memory operations

### Core Modules
- **users.rs:** User management, balances, notifications, filters
- **posts.rs:** Post creation, extensions (polls, proposals, reposts)
- **domains.rs:** Domain configuration and realm filtering
- **memory.rs:** Memory allocation and management
- **pfp.rs:** Profile picture generation with deterministic palettes

### HTTP Interface
- Serves profile pictures, metadata, and API endpoints
- Handles routing for different content types (images, JSON, HTML)
- Implements caching strategies for static assets
- Provides social media metadata for link previews
- Uses asset certification for security

### Query System
- Extensive query methods for posts, users, realms, transactions
- Pagination support with configurable page sizes (CONFIG.feed_page_size)
- Complex filtering and sorting capabilities
- Search functionality across content
- Delegation support for principal resolution

### Economic Model
- Users have balances (credits, tokens, rewards)
- Credit transfers with fees
- Revenue sharing mechanisms
- Auction system for token distribution

## 4. Project Structure

```
/
├── src/
│   ├── backend/              # Main backend Rust canister ('taggr')
│   │   ├── env/             # Core modules
│   │   │   ├── domains.rs   # Domain and realm configuration
│   │   │   ├── memory.rs    # Memory allocation and management
│   │   │   ├── mod.rs       # State management and core functions
│   │   │   ├── pfp.rs       # Profile picture generation
│   │   │   ├── post.rs      # Post data structures and operations
│   │   │   └── user.rs      # User management and economics
│   │   ├── lib.rs           # Public interface (read/mutate)
│   │   ├── queries.rs       # Query methods implementation
│   │   ├── http.rs          # HTTP request handling
│   │   ├── metadata.rs      # HTML metadata generation
│   │   ├── taggr.did        # Candid interface definition
│   │   └── updates.rs       # Update methods and timers
│   ├── bucket/              # Storage canister for blobs/assets
│   │   └── src/lib.rs       # Blob storage operations
│   └── frontend/            # React/TypeScript frontend
│       └── src/
│           ├── api.ts       # Backend canister interaction
│           ├── feed.tsx     # Feed component
│           ├── image_preview.ts # Image utilities
│           ├── types.tsx    # TypeScript type definitions
│           ├── wallet.tsx   # Wallet/balance display
│           ├── welcome.tsx  # Welcome/onboarding
│           └── index.tsx    # Frontend entry point
├── tests/                   # Rust integration tests
├── e2e/                    # Playwright end-to-end tests
│   └── test1.spec.ts       # Test with file hashing utilities
├── dfx.json                # Internet Computer project config
├── package.json            # Frontend dependencies and scripts
├── Cargo.toml              # Rust workspace configuration
├── build.sh                # Script for building Rust canisters to WASM
└── Makefile                # Helper commands
```

## 5. Canisters

- **`taggr`**: Main backend canister with core business logic
- **`bucket`**: Storage canister for handling large blobs and assets
- **`frontend`**: Asset canister serving the compiled React application

## 6. Development Workflows

### Backend (Rust)
```bash
# Build with specific features
FEATURES=dev ./build.sh taggr

# Run integration tests
cargo test

# Run specific test module
cargo test --test integration_tests
```

### Frontend (React)
```bash
# Start development server
npm start

# Build for production
npm run build

# Run E2E tests (ensure local replica is running)
npm run test:e2e
```

### Full Project (Makefile)
```bash
# Start local replica
make start

# Deploy to local replica
make local_deploy

# Run all tests
make test

# Deploy to staging
make staging_deploy
```

## 7. Key Data Types

**Backend (Rust):**
- `UserId`: User identifier
- `PostId`: Post identifier (u64)
- `Principal`: Internet Computer principal
- `Credits`, `Token`: Economic units
- `Extension`: Post extensions (Poll, Proposal, Repost, Feature)

**Frontend (TypeScript):**
- Mirrors Rust types in `types.tsx`
- PostId, DomainConfig, UserFilter, Extension types

## 8. HTTP API Endpoints

Key HTTP endpoints include:
- `/pfp/{user_id}`: Profile pictures with caching
- `/api/v1/proposals`: Proposal data with pagination
- `/api/v1/metadata`: Token and platform metadata
- Various routes for posts, users, realms with metadata for social sharing

## 9. Query Methods

Important query methods:
- `posts`: Retrieve posts by IDs
- `user`: Get user profile data
- `realms`: Fetch realm information
- `transactions`: Access transaction history
- `hot_posts`, `last_posts`: Various feed views
- `search`: Content search functionality

## 10. Memory and Storage Patterns

- Custom allocator manages objects in stable memory
- ObjectManager provides CRUD operations for serializable types
- Bucket canister handles large binary data (images, assets)
- Memory growth is managed through stable_grow operations

## 11. Important Considerations

1. **State Persistence:** All state is managed through custom memory allocator
2. **Economic Operations:** Credit transfers, rewards, and fees must maintain consistency
3. **Access Control:** Principal-based authentication throughout
4. **Memory Limits:** Be mindful of stable memory growth patterns
5. **Error Handling:** Proper error propagation in canister calls
6. **HTTP Headers:** Correct caching and content-type headers are crucial
7. **Pagination:** Large datasets use pagination to manage memory usage
8. **Testing:** Use PocketIC for integration tests, Playwright for E2E tests
