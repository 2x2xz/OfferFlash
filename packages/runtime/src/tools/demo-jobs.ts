import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const demoJobsParameters = Type.Object(
  {
    city: Type.String({ minLength: 1, maxLength: 80 }),
    keyword: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const demoJobSchema = Type.Object(
  {
    id: Type.String(),
    company: Type.String(),
    title: Type.String(),
    city: Type.String(),
    sourceURL: Type.String({ pattern: "^https://example\\.invalid/" }),
    publishedAt: Type.Null(),
  },
  { additionalProperties: false },
);

export const demoJobsResultSchema = Type.Object(
  {
    demo: Type.Literal(true),
    jobs: Type.Array(demoJobSchema),
  },
  { additionalProperties: false },
);

export type DemoJobsResult = Static<typeof demoJobsResultSchema>;

// These records are fictional fixtures; no company, URL, or publication date is verified.
const demoJobs: DemoJobsResult["jobs"] = [
  {
    id: "fixture-hangzhou-llm-1",
    company: "演示企业 A（虚构）",
    title: "大模型算法工程师（虚构校招岗位）",
    city: "杭州",
    sourceURL: "https://example.invalid/jobs/fixture-hangzhou-llm-1",
    publishedAt: null,
  },
  {
    id: "fixture-hangzhou-llm-2",
    company: "演示企业 B（虚构）",
    title: "大模型应用研究工程师（虚构校招岗位）",
    city: "杭州",
    sourceURL: "https://example.invalid/jobs/fixture-hangzhou-llm-2",
    publishedAt: null,
  },
  {
    id: "fixture-beijing-llm-1",
    company: "演示企业 C（虚构）",
    title: "大模型训练算法工程师（虚构校招岗位）",
    city: "北京",
    sourceURL: "https://example.invalid/jobs/fixture-beijing-llm-1",
    publishedAt: null,
  },
];

export interface DemoJobsToolOptions {
  delayMs?: number;
  onStart?: (toolCallId: string) => void;
  onCleanup?: () => Promise<void> | void;
}

function abortError(): Error {
  const error = new Error("演示岗位搜索已取消");
  error.name = "AbortError";
  return error;
}

export function throwAbortError(): never {
  throw abortError();
}

async function waitForDemoDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throwAbortError();
  if (delayMs === 0) return;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function createDemoJobsTool(
  options: DemoJobsToolOptions = {},
): ToolDefinition<typeof demoJobsParameters, DemoJobsResult> {
  const delayMs = options.delayMs ?? 0;
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2_147_483_647) {
    throw new RangeError("delayMs 必须是有效的非负定时器时长");
  }

  return {
    name: "search_demo_jobs",
    label: "搜索虚构演示岗位",
    description:
      "按城市和岗位名称关键词筛选本地虚构演示数据。不会访问网络，不代表真实企业岗位、发布日期或最新招聘信息。",
    parameters: demoJobsParameters,
    outputSchema: demoJobsResultSchema,
    executionMode: "sequential",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(toolCallId, params, signal) {
      // Revalidate at the operation boundary: SDK hooks can mutate prevalidated args.
      if (!Value.Check(demoJobsParameters, params)) {
        throw new TypeError("演示搜索参数必须只有有效的 city 和 keyword 字符串");
      }
      const query = structuredClone(params);

      try {
        if (signal?.aborted) throwAbortError();
        options.onStart?.(toolCallId);
        await waitForDemoDelay(delayMs, signal);
        if (signal?.aborted) throwAbortError();

        const city = query.city.trim();
        const keyword = query.keyword.trim().toLocaleLowerCase();
        const result: DemoJobsResult = {
          demo: true,
          jobs: demoJobs
            .filter((job) => job.city === city && job.title.toLocaleLowerCase().includes(keyword))
            .map((job) => ({ ...job })),
        };
        if (!Value.Check(demoJobsResultSchema, result)) {
          throw new TypeError("演示岗位结果不符合输出格式");
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          structuredContent: result,
        };
      } finally {
        await options.onCleanup?.();
      }
    },
  };
}
