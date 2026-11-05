- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md`
  summary: Add an automated smoke check that the built Docker image serves the SPA at `/` (default `frontend_dist`, Dockerfile COPY layout, `parents[2]`).
  evidence: Review pass 1, finding #4. `create_app` only logs a warning when dist is missing, so a layout change would make the container serve the API only, with every pytest green. The check needs CI or a container harness, which doesn't exist yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md`
  summary: Replace AGENTS.md's TODO "Running and verifying" section with the verified commands from README (via `bmad-project-context` refresh).
  evidence: Review pass 1, finding #26. The scaffold now exists, and AGENTS.md says to replace the TODO on the first refresh after scaffolding. Include: `Accept: text/html` SPA fallback, compose URL overrides, and that Windows dev needs `uvicorn --reload` (psycopg async can't use the Proactor loop; finding #22).
