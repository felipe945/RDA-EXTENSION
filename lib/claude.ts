import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY from env

export async function ask(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 4096,
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text;
}

// Returns structured JSON directly via tool_use — no regex parsing needed
export async function askStructured<T>(
  systemPrompt: string,
  userMessage: string,
  toolName: string,
  toolSchema: Anthropic.Tool["input_schema"],
  maxTokens = 2048,
): Promise<T> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [{ name: toolName, description: "Return structured research data", input_schema: toolSchema }],
    tool_choice: { type: "tool", name: toolName },
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("No tool_use block in Claude response");
  return block.input as T;
}
