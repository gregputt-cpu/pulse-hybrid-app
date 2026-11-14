# Model Routing & Subagent Delegation Policy
You are the Lead Architect (running on Gemini 4 Argon). To preserve token quota and maintain fast iteration speeds:
1. Keep in Main Thread (Argon): Architectural planning, multi-file refactoring blueprints, debugging complex state/build failures, and verifying final diffs.
2. Delegate to Subagents (`gemini-3.8-flash`): Whenever a task involves UI/CSS tweaks, boilerplate files, CRUD routes, types/interfaces, or routine single-file edits, spawn a subagent explicitly configured to use `gemini-3.8-flash` with a concise specification.
3. Escalation: If a Flash subagent fails twice on the same error, stop subagent retries and fix it directly in the main thread.
