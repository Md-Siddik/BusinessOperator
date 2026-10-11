/** Chat widget texts. Plain module (no "use client") so server layouts can read the keys. */
export type ChatWidgetLabels = {
  open: string;
  close: string;
  title: string;
  signupTitle: string;
  signupText: string;
  signup: string;
  login: string;
  teamText: string;
  openInbox: string;
  placeholder: string;
  send: string;
  empty: string;
  pending: string;
  you: string;
  team: string;
  error: string;
  fullInbox: string;
  teamTitle: string;
  noConversations: string;
  back: string;
};

export const DEFAULT_CHAT_LABELS: ChatWidgetLabels = {
  open: "Message us",
  close: "Close chat",
  title: "Chat with ExploreTechify",
  signupTitle: "Sign up to message us",
  signupText: "Create a free client account to chat with our team. Your conversation stays in your account, so you can pick it up any time.",
  signup: "Sign up",
  login: "Log in",
  teamText: "You're signed in as a team member. Client conversations are in your inbox.",
  openInbox: "Open inbox",
  placeholder: "Write a message…",
  send: "Send",
  empty: "Tell us what you need — we'll reply here.",
  pending: "Your account is awaiting approval. You can already chat with us here.",
  you: "You",
  team: "ExploreTechify",
  error: "Message could not be sent. Please try again.",
  fullInbox: "Open full inbox",
  teamTitle: "Client messages",
  noConversations: "No client conversations yet. New messages appear here instantly.",
  back: "Back to conversations",
};
