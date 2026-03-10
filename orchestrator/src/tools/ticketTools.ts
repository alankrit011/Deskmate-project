/**
 * Mock Internal IT System Tools
 *
 * These simulate real integrations (ServiceNow, JIRA, etc.) that would exist
 * in production. Using mock functions lets us demonstrate full agentic behavior
 * without needing live system credentials .
 *
 * Each tool returns realistic structured data and simulates occasional failures
 * so the agent's error-handling logic gets exercised.
 */

import { get_logger } from "../logger";

const logger = get_logger("ticket-tools");

// ── Types ──────────────────────────────────────────────────────────────────

export interface Ticket {
  ticketId: string;
  subject: string;
  status: "Open" | "In Progress" | "Resolved" | "Closed";
  priority: "Low" | "Medium" | "High" | "Critical";
  createdAt: string;
  description?: string;
}

export interface CreateTicketResult {
  success: boolean;
  ticketId: string;
  message: string;
  assignedTo?: string;
}

export interface SoftwareEntitlementResult {
  employeeId: string;
  software: string;
  entitled: boolean;
  approvalRequired: boolean;
  approvalTier?: string;
  annualCostEstimate?: number;
}

// ── Seeded mock data — realistic enough for a demo ─────────────────────────

const MOCK_TICKETS: Record<string, Ticket[]> = {
  E1001: [
    {
      ticketId: "INC-4021",
      subject: "Outlook not syncing",
      status: "Resolved",
      priority: "Medium",
      createdAt: "2026-02-15T09:00:00Z",
      description: "Outlook calendar not syncing with Exchange after OS update.",
    },
    {
      ticketId: "INC-4056",
      subject: "VPN access request",
      status: "Open",
      priority: "High",
      createdAt: "2026-03-01T14:30:00Z",
      description: "Need VPN access for remote work from home office.",
    },
  ],
  E1002: [
    {
      ticketId: "INC-3987",
      subject: "Password reset request",
      status: "Resolved",
      priority: "Low",
      createdAt: "2026-02-20T11:00:00Z",
    },
  ],
};

// Counter for generating new ticket IDs in this session
let ticketCounter = 4102;

// ── Tool 1: getEmployeeTickets ─────────────────────────────────────────────

/**
 * Retrieve all support tickets associated with an employee.
 *
 * Why return all tickets (not just open ones)?
 * The agent needs full context — a "Resolved" ticket might be relevant
 * if the user is reporting the same issue recurring. The agent can filter.
 */
export function getEmployeeTickets(employeeId: string): Ticket[] {
  const start = Date.now();

  const tickets = MOCK_TICKETS[employeeId] ?? [];

  logger.info({
    event: "tool_call",
    tool: "getEmployeeTickets",
    input: { employeeId },
    output: { ticketCount: tickets.length },
    latency_ms: Date.now() - start,
  });

  return tickets;
}

// ── Tool 2: createSupportTicket ────────────────────────────────────────────

/**
 * Create a new IT support ticket.
 *
 * Validation: subject and description are required to prevent the agent
 * from creating low-quality tickets. If missing, we return an error so the
 * agent knows to ask the user for more detail.
 */
export function createSupportTicket(
  employeeId: string,
  subject: string,
  description: string,
  priority: string = "Medium"
): CreateTicketResult {
  const start = Date.now();

  // Basic validation — the agent should handle this gracefully
  if (!subject || subject.trim().length < 5) {
    const error = {
      success: false,
      ticketId: "",
      message: "Ticket creation failed: subject must be at least 5 characters.",
    };
    logger.warn({
      event: "tool_call",
      tool: "createSupportTicket",
      input: { employeeId, subject, priority },
      output: error,
      latency_ms: Date.now() - start,
    });
    return error;
  }

  if (!description || description.trim().length < 10) {
    const error = {
      success: false,
      ticketId: "",
      message:
        "Ticket creation failed: description must be at least 10 characters. Please ask the user to provide more detail.",
    };
    logger.warn({
      event: "tool_call",
      tool: "createSupportTicket",
      input: { employeeId, subject, priority },
      output: error,
      latency_ms: Date.now() - start,
    });
    return error;
  }

  const ticketId = `INC-${ticketCounter++}`;
  const newTicket: Ticket = {
    ticketId,
    subject,
    description,
    status: "Open",
    priority: priority as Ticket["priority"],
    createdAt: new Date().toISOString(),
  };

  // Persist in-memory for this session so getEmployeeTickets reflects it
  if (!MOCK_TICKETS[employeeId]) {
    MOCK_TICKETS[employeeId] = [];
  }
  MOCK_TICKETS[employeeId].push(newTicket);

  const result: CreateTicketResult = {
    success: true,
    ticketId,
    message: "Ticket created and assigned to L1 Support.",
    assignedTo: "L1 Support Team",
  };

  logger.info({
    event: "tool_call",
    tool: "createSupportTicket",
    input: { employeeId, subject, description, priority },
    output: result,
    latency_ms: Date.now() - start,
  });

  return result;
}

// ── Tool 3: checkSoftwareEntitlement ──────────────────────────────────────

/**
 * Check whether an employee is entitled to a specific software package.
 *
 * Approval tiers come from the IT Handbook:
 *   - < $500/year: manager approval not required
 *   - $500–$2000/year: manager approval via ServiceNow required
 *   - > $2000/year: VP-level approval required
 */
const SOFTWARE_CATALOG: Record<
  string,
  { entitled: boolean; approvalRequired: boolean; approvalTier: string; annualCostEstimate: number }
> = {
  "adobe creative suite": {
    entitled: false,
    approvalRequired: true,
    approvalTier: "Manager approval via ServiceNow",
    annualCostEstimate: 600,
  },
  "microsoft office 365": {
    entitled: true,
    approvalRequired: false,
    approvalTier: "None — standard entitlement",
    annualCostEstimate: 0,
  },
  zoom: {
    entitled: true,
    approvalRequired: false,
    approvalTier: "None — standard entitlement",
    annualCostEstimate: 0,
  },
  slack: {
    entitled: true,
    approvalRequired: false,
    approvalTier: "None — standard entitlement",
    annualCostEstimate: 0,
  },
  tableau: {
    entitled: false,
    approvalRequired: true,
    approvalTier: "VP approval required (>$2000/year)",
    annualCostEstimate: 2500,
  },
  github: {
    entitled: false,
    approvalRequired: true,
    approvalTier: "Manager approval via ServiceNow",
    annualCostEstimate: 200,
  },
};

export function checkSoftwareEntitlement(
  employeeId: string,
  softwareName: string
): SoftwareEntitlementResult {
  const start = Date.now();

  const key = softwareName.toLowerCase().trim();
  const entry = SOFTWARE_CATALOG[key];

  const result: SoftwareEntitlementResult = entry
    ? { employeeId, software: softwareName, ...entry }
    : {
        // Unknown software — default to requiring approval
        employeeId,
        software: softwareName,
        entitled: false,
        approvalRequired: true,
        approvalTier: "Manager approval required — software not in catalog",
        annualCostEstimate: -1,
      };

  logger.info({
    event: "tool_call",
    tool: "checkSoftwareEntitlement",
    input: { employeeId, softwareName },
    output: result,
    latency_ms: Date.now() - start,
  });

  return result;
}
