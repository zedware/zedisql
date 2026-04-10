# ZedISQL

![ZedISQL Hero Mockup](/Users/zedware/.gemini/antigravity/brain/da430709-b076-4d1a-902c-2881e97f87d8/zedisql_hero_mockup_1775836606143.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange)](https://www.rust-lang.org/)

**ZedISQL** is a high-performance, professional-grade PostgreSQL GUI client designed for developers who value speed, aesthetics, and a clean workflow. Built with **Rust (Tauri)** and **TypeScript**, it offers a lightweight but powerful alternative to bulky database managers.

## 🚀 Key Features

- **Dynamic Multi-Tab Interface**: Work on multiple queries simultaneously with isolated sessions and intuitive tab management.
- **Real-time Server Metrics**: Integrated dashboard providing live monitoring of active sessions and Transactions Per Second (TPS).
- **Dynamic Object Explorer**: A hierarchical database browser with on-demand expansion and auto-fetching of database objects.
- **Comprehensive Type Support**: Native rendering for complex PostgreSQL types including Timestamps, BigInts, and Decimals.
- **Developer-Centric UX**:
  - Hotkey-driven workflow (F5 for Execute, Cmd+R for Refresh).
  - Smart connection modal auto-popup on startup.
  - Professional glassmorphism dark theme.

## 🛠 Technology Stack

- **Backend**: Rust, Tauri, SQLx (Asynchronous PostgreSQL)
- **Frontend**: TypeScript, Vanilla CSS (Custom Design System)
- **Dependencies**: Chrono (Timestamps), Rust Decimal (Precision Math), Tokio (Async Runtime)

## 📦 Getting Started

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (npm)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/zedisql.git
   cd zedisql
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run tauri dev
   ```

## 🤖 AI Collaboration
This project was developed in close collaboration with the **Antigravity (Gemini)** AI agent. For details on the AI-assisted development process, see [GEMINI.md](./GEMINI.md).

---
*ZedISQL - Empowering your PostgreSQL workflow.*
