import { createExtensionRuntime, type ResourceLoader } from '@earendil-works/pi-coding-agent';

// The host supplies the prompt. Nothing is discovered from ~/.pi or the project.
export function createOfferResourceLoader(systemPrompt: string): ResourceLoader {
  const extensionRuntime = createExtensionRuntime();
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: extensionRuntime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
