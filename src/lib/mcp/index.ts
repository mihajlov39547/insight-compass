import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listPlantCasesTool from "./tools/list-plant-cases";
import getPlantCaseTool from "./tools/get-plant-case";
import listNotebooksTool from "./tools/list-notebooks";
import listProjectsTool from "./tools/list-projects";

// Build the OAuth issuer from the Supabase project ref (inlined by Vite at
// build time). The fallback keeps the entry importable during the throwaway
// manifest-extraction eval, where no token is verified.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "researcher-mcp",
  title: "Researcher",
  version: "0.1.0",
  instructions:
    "Read-only tools for the signed-in Researcher user. Use `whoami` to verify the connected account, `list_projects` and `list_notebooks` to browse the user's workspace, and `list_plant_cases`/`get_plant_case` to inspect Plant Advisor cases including confirmed identifications and disease diagnoses. All tools scope to the authenticated user; do not fabricate ids.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    whoamiTool,
    listProjectsTool,
    listNotebooksTool,
    listPlantCasesTool,
    getPlantCaseTool,
  ],
});
