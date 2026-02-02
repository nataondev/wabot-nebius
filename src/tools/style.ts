import OpenAI from "openai";

export const styleResponseTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "style_response",
    description:
      "Configure how the response should be sent. Use 'quote' when answering a specific user's question directly. Use 'general' for general statements or broadcasts.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["quote", "general"],
          description: "Response mode. 'quote' mentions/replies to the user. 'general' sends without tag.",
        },
      },
      required: ["mode"],
    },
  },
};
