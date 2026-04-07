# RBAC Share Validation Checklist

## Scope
Validate Viewer, Editor, Admin, and Owner behavior for:
- Projects
- Notebooks
- Chats
- Documents
- Sharing

## Product Decisions Confirmed
- Viewer: can view and reply in existing chats only
- Editor: can create chats and upload/delete documents in shared scope
- Admin: can do owner-like management except cannot archive/delete project/notebook
- Owner: full control
- Chat rename/delete: admin+ only
- Editor document delete policy: editor can delete any document in the shared workspace

## Backend-Critical Paths
Verify each action by direct API/UI trigger and by guarded UI action.

### Project checks
- [ ] Viewer can view project
- [ ] Viewer can view chats
- [ ] Viewer can send message in existing chat
- [ ] Viewer cannot create chat
- [ ] Viewer cannot rename chat
- [ ] Viewer cannot delete chat
- [ ] Viewer cannot rename project
- [ ] Viewer cannot manage sharing
- [ ] Viewer cannot upload documents
- [ ] Viewer cannot delete documents
- [ ] Viewer cannot archive project
- [ ] Viewer cannot delete project

- [ ] Editor can view project
- [ ] Editor can send message in existing chat
- [ ] Editor can create chat
- [ ] Editor cannot rename chat
- [ ] Editor cannot delete chat
- [ ] Editor can upload documents
- [ ] Editor can delete documents (any document in shared project)
- [ ] Editor cannot rename project
- [ ] Editor cannot manage sharing
- [ ] Editor cannot archive project
- [ ] Editor cannot delete project

- [ ] Admin can manage sharing
- [ ] Admin can rename project
- [ ] Admin can create/rename/delete chats
- [ ] Admin can upload/delete documents
- [ ] Admin cannot archive project
- [ ] Admin cannot delete project

### Notebook checks
- [ ] Viewer can view notebook content
- [ ] Viewer can send message in existing notebook chat
- [ ] Viewer cannot rename notebook
- [ ] Viewer cannot manage sharing
- [ ] Viewer cannot upload/delete/toggle notebook sources
- [ ] Viewer cannot create/edit/delete notes
- [ ] Viewer cannot archive notebook
- [ ] Viewer cannot delete notebook

- [ ] Editor can send message in notebook
- [ ] Editor can upload/delete/toggle notebook sources
- [ ] Editor can create/edit/delete notes
- [ ] Editor cannot rename notebook
- [ ] Editor cannot manage sharing
- [ ] Editor cannot archive notebook
- [ ] Editor cannot delete notebook

- [ ] Admin can rename notebook
- [ ] Admin can manage sharing
- [ ] Admin can manage notebook sources and notes
- [ ] Admin cannot archive notebook
- [ ] Admin cannot delete notebook

## Security edge cases
- [ ] Viewer blocked from creating chat through direct API request
- [ ] Editor blocked from rename/share through direct API request
- [ ] Admin blocked from archive/delete project/notebook through direct API request
- [ ] Removing share membership immediately revokes access
- [ ] Search and navigation only return accessible resources
- [ ] Shared users cannot access unrelated resources

## Notes
- This checklist should be executed against a seeded environment with at least 4 users: owner, admin, editor, viewer.
- Include screenshots or API error payload captures for all denied actions.
