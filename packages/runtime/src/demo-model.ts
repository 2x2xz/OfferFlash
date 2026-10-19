import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { demoJobsResultSchema } from "./tools/demo-jobs.js";

/** A real Pi model runtime using the official scripted provider; no model network calls. */
export async function createDemoModel() {
  const faux = fauxProvider({
    provider: "offeragent-demo",
    models: [{ id: "offeragent-demo-model", name: "OfferAgent 虚构演示模型", reasoning: false }],
    tokenSize: { min: 4, max: 4 },
  });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ providers: [faux.provider.id], allowNetwork: false });
  return { modelRuntime, model: faux.getModel(), faux };
}

/** The follow-up reads the actual tool result rather than assuming the search succeeded. */
export function makeJobSearchResponses(): FauxResponseStep[] {
  return [
    fauxAssistantMessage(
      fauxToolCall("search_demo_jobs", { city: "杭州", keyword: "大模型" }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const toolResult = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "search_demo_jobs",
      );
      if (!toolResult || toolResult.role !== "toolResult") {
        return fauxAssistantMessage("没有收到演示搜索的工具结果，暂时无法确认找到哪些岗位。");
      }
      if (toolResult.isError) {
        return fauxAssistantMessage("演示搜索未完成，工具返回了错误；没有确认任何岗位结果。");
      }

      const text = toolResult.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fauxAssistantMessage("演示搜索结果无法解析，暂时无法确认岗位信息。");
      }
      if (!Value.Check(demoJobsResultSchema, parsed)) {
        return fauxAssistantMessage("演示搜索结果的格式不完整，暂时无法确认岗位信息。");
      }

      const names = parsed.jobs.map((job) => `${job.company}：${job.title}`).join("；");
      return fauxAssistantMessage(
        `本地虚构演示数据返回 ${parsed.jobs.length} 个岗位${names ? `：${names}` : ""}。` +
          "这些记录只用于验证 Agent 工具调用，不是真实或最新招聘信息。",
      );
    },
  ];
}
