import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewWorkflowModal } from "../src/templates/NewWorkflowModal";
import type { WorkflowsApi } from "../src/api/client";
import type { CreateWorkflowBody, SpecDetail } from "../src/api/types";

function stubClient(overrides: Partial<WorkflowsApi> = {}): WorkflowsApi {
  const base = {
    createWorkflow: vi.fn(
      async (_body: CreateWorkflowBody): Promise<SpecDetail> => ({
        workflow: { id: "x" } as never,
        path: "/x.yaml",
      }),
    ),
  };
  return { ...base, ...overrides } as unknown as WorkflowsApi;
}

async function fillIdAndName(id: string, name: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/^id/i), id);
  await userEvent.type(screen.getByLabelText(/^name/i), name);
}

describe("NewWorkflowModal", () => {
  it("renders id, name, scope, and trigger fields", () => {
    render(<NewWorkflowModal onCreated={() => {}} onCancel={() => {}} client={stubClient()} />);
    expect(screen.getByLabelText(/^id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scope/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/trigger/i)).toBeInTheDocument();
  });

  it("creates a seeded workflow and reports the new id", async () => {
    const createWorkflow = vi.fn(
      async (_body: CreateWorkflowBody): Promise<SpecDetail> => ({
        workflow: { id: "fresh" } as never,
        path: "/fresh.yaml",
      }),
    );
    const onCreated = vi.fn();
    render(
      <NewWorkflowModal onCreated={onCreated} onCancel={() => {}} client={stubClient({ createWorkflow })} />,
    );

    await fillIdAndName("fresh", "Fresh One");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(createWorkflow).toHaveBeenCalledTimes(1));
    const body = createWorkflow.mock.calls[0]![0] as { workflow: { id: string; name: string; nodes: unknown[] } };
    expect(body.workflow.id).toBe("fresh");
    expect(body.workflow.name).toBe("Fresh One");
    expect(body.workflow.nodes).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledWith("fresh");
  });

  it("includes the cron schedule when the trigger is cron", async () => {
    const createWorkflow = vi.fn(
      async (_body: CreateWorkflowBody): Promise<SpecDetail> => ({
        workflow: { id: "c" } as never,
        path: "/c.yaml",
      }),
    );
    render(
      <NewWorkflowModal onCreated={() => {}} onCancel={() => {}} client={stubClient({ createWorkflow })} />,
    );

    await fillIdAndName("nightly", "Nightly");
    await userEvent.selectOptions(screen.getByLabelText(/trigger/i), "cron");
    await userEvent.type(screen.getByLabelText(/schedule/i), "0 5 * * *");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(createWorkflow).toHaveBeenCalled());
    const body = createWorkflow.mock.calls[0]![0] as { workflow: { trigger: { type: string; schedule?: string } } };
    expect(body.workflow.trigger).toEqual({ type: "cron", schedule: "0 5 * * *" });
  });

  it("rejects an invalid id slug client-side without calling the API", async () => {
    const createWorkflow = vi.fn();
    const onCreated = vi.fn();
    render(
      <NewWorkflowModal
        onCreated={onCreated}
        onCancel={() => {}}
        client={stubClient({ createWorkflow })}
      />,
    );

    await fillIdAndName("bad id!", "Bad");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/id/i);
    expect(createWorkflow).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate-id rejection and does not report success", async () => {
    const createWorkflow = vi.fn(async () => {
      throw new Error("workflow 'dup' already exists");
    });
    const onCreated = vi.fn();
    render(
      <NewWorkflowModal
        onCreated={onCreated}
        onCancel={() => {}}
        client={stubClient({ createWorkflow })}
      />,
    );

    await fillIdAndName("dup", "Dup");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("cancels without creating", async () => {
    const onCancel = vi.fn();
    render(<NewWorkflowModal onCreated={() => {}} onCancel={onCancel} client={stubClient()} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
