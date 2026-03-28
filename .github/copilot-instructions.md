# Workspace Instructions for Image Manager (Flask + PostgreSQL + Cloudinary)

## Purpose
This file defines conventions, architecture, and best practices for the `pagina-web` project. It is intended for AI agents and developers to ensure consistency and productivity.

---

## 1. Project Overview
- **Type:** Fullstack web app for photo print orders
- **Stack:** Flask, PostgreSQL, Cloudinary, HTML/CSS/JS
- **Key Features:**
  - Multi-role (admin, operator, cashier) order management
  - Dynamic photo size/pricing sync (admin <-> index)
  - Resilient autosave (local + server)
  - Cloudinary integration for uploads/cleanup
  - Automated DB backups

---

## 2. Key Conventions
- **Backend:**
  - All API endpoints are defined in `SEVER/app.py`.
  - ORM models in `SEVER/db.py` (pattern: `db = SQLAlchemy()` in `db.py`, `db.init_app(app)` in `app.py`).
  - Auth logic in `SEVER/auth.py` (session + bearer token, role-based decorators).
  - Jobs (cleanup, backup) run as background tasks in `app.py`.
- **Frontend:**
  - Public scripts in `SEVER/static/script/` (see README for mapping).
  - Templates in `SEVER/templates/`.
  - Admin dashboard logic in `dasbord_admin.js`.
  - Dynamic photo size sync in `precios_fotos.js` (polls `/api/tamanos`).
- **Docs:**
  - API and data model details in `docs/database.md` and `docs/tamanos-admin-sync.md`.
  - Link to docs, do not duplicate content.

---

## 3. Build & Run
- **Local:**
  - `python -m venv .venv && .venv\Scripts\activate`
  - `pip install -r requirements.txt`
  - `python SEVER/app.py`
- **Docker:**
  - `docker compose up --build`
- **Entrypoint:**
  - Main app: `SEVER/app.py`
  - Default URL: `http://localhost:5000` (local), `http://localhost:8080` (docker)

---

## 4. Environment & Secrets
- Use `.ENV` for all secrets and config (see README for required vars).
- Never commit `.ENV` to version control.

---

## 5. Testing & Extensibility
- No formal test suite yet; see README for extension ideas.
- For new features, follow existing file/module patterns.
- Link to relevant doc files for API/data model changes.

---

## 6. Anti-patterns
- Do **not** duplicate documentation from `docs/` or `README.md`—link instead.
- Avoid hardcoding secrets or config in code.
- Do not bypass ORM for DB access.
- Do not mix admin/operator/cashier logic in frontend scripts—keep role separation.

---

## 7. Useful Links
- [README.md](../README.md): Full project overview, API, setup, and environment variables
- [docs/database.md](../docs/database.md): DB schema, API endpoints, and flow
- [docs/tamanos-admin-sync.md](../docs/tamanos-admin-sync.md): Photo size admin sync logic

---

## 8. Example Prompts
- "How do I add a new photo size and sync it to the index page?"
- "What is the backup retention policy and how do I trigger a manual backup?"
- "Where is the autosave logic implemented for the order form?"
- "How do I add a new admin-only API endpoint?"

---

## 9. Next Agent Customizations
- **/create-instruction frontend-integration**: For detailed frontend-backend sync patterns (e.g., polling, BroadcastChannel)
- **/create-skill db-backup-restore**: For DB backup/restore automation and troubleshooting
- **/create-instruction auth-session**: For session and token management best practices

---

*For any new module or feature, update this file and link to new or updated documentation as needed.*
