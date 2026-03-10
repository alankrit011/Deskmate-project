/**
 * API client for the DeskMate orchestration service.
 * All fetch calls live here — easy to swap base URL or add auth headers later.
 */

import type { ChatApiResponse, ConversationHistory } from "../types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export async function sendMessage(
  message: string,
  employeeId: string,
  history: ConversationHistory[] = []
): Promise<ChatApiResponse> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, employeeId, history }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `API error ${res.status}`);
  }

  return res.json();
}

export async function sendDebugMessage(
  message: string,
  employeeId: string,
  history: ConversationHistory[] = []
): Promise<ChatApiResponse> {
  const res = await fetch(`${BASE_URL}/api/debug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, employeeId, history }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `API error ${res.status}`);
  }

  return res.json();
}
