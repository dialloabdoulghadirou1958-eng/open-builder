export function isGenerationRunCurrent(
  runConversationId: string | null,
  activeConversationId: string | null,
  currentRunConversationId: string | null,
): boolean {
  return (
    !!runConversationId &&
    runConversationId === activeConversationId &&
    runConversationId === currentRunConversationId
  );
}
