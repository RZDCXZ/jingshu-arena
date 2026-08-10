"use client";

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Camera,
  CaretRight,
  CheckCircle,
  Clock,
  ImageSquare,
  Info,
  Lock,
  Package,
  Plus,
  ShieldCheck,
  Trash,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  RepairCommandResponse,
  RepairCreatedResponse,
  RepairDetailResponse,
  RepairImageCompletionResponse,
  RepairImageListResponse,
  RepairImageSaved,
  RepairResolutionCommandResponse,
  RepairSampleImageResponse,
  RepairSpareCommandResponse,
  RepairVerificationCommandResponse,
  StaffRepairIntakeResponse,
  StaffRepairQueueResponse,
} from "@jingshu/contracts";

import repairSample from "../../../product-ui/miniprogram/design-prototype/public/assets/repair-headset-sample.png";

interface StaffRepairFile {
  readonly file: File;
  readonly id: string;
  readonly previewUrl: string;
}

const statusLabels = {
  assigned: "已分派",
  closed: "已关闭",
  new: "新建",
  processing: "处理中",
  verification: "待验证",
} as const;

const priorityLabels = {
  high: "较高",
  normal: "普通",
  urgent: "紧急",
} as const;

const reservationStatusLabels = {
  arrived: "已到店",
  cancelled: "已取消",
  completed: "已完成",
  confirmed: "已确认",
  expired: "已过期",
  "in-use": "使用中",
  "pending-confirmation": "待确认",
} as const;

export function StaffRepairQueue({
  csrfToken,
  onToast,
  refreshKey,
  role,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
  role: "manager" | "staff";
}) {
  const [queue, setQueue] = useState<StaffRepairQueueResponse | null>(null);
  const [intake, setIntake] = useState<StaffRepairIntakeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<
    ReadonlyArray<RepairImageSaved>
  >([]);
  const [detail, setDetail] = useState<RepairDetailResponse | null>(null);
  const [actionDialog, setActionDialog] = useState<"assign" | "start" | null>(
    null,
  );
  const [assigneePersonaId, setAssigneePersonaId] = useState("");
  const [actionPriority, setActionPriority] = useState<
    "normal" | "high" | "urgent"
  >("normal");
  const [publicNote, setPublicNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [actionFailure, setActionFailure] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const actionRetryRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const [workflowDialog, setWorkflowDialog] = useState<
    | "claim-spare"
    | "return-spare"
    | "resolution"
    | "verify-success"
    | "verify-failure"
    | null
  >(null);
  const [workflowInventoryItemId, setWorkflowInventoryItemId] = useState("");
  const [workflowUsageId, setWorkflowUsageId] = useState("");
  const [workflowQuantity, setWorkflowQuantity] = useState(1);
  const [workflowNote, setWorkflowNote] = useState("");
  const [workflowFailure, setWorkflowFailure] = useState("");
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const workflowRetryRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seatId, setSeatId] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<ReadonlyArray<StaffRepairFile>>([]);
  const [sampleSelected, setSampleSelected] = useState(false);
  const [imageNotice, setImageNotice] = useState("");
  const [dialogFailure, setDialogFailure] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [imageRetrying, setImageRetrying] = useState(false);
  const [result, setResult] = useState<RepairCreatedResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure("");
    try {
      const [queueResponse, intakeResponse] = await Promise.all([
        fetch("/api/v1/staff/repairs", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetch("/api/v1/staff/repair-intake", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ]);
      const queuePayload = (await queueResponse.json()) as
        ApiErrorResponse | StaffRepairQueueResponse;
      const intakePayload = (await intakeResponse.json()) as
        ApiErrorResponse | StaffRepairIntakeResponse;
      if (!queueResponse.ok || !intakeResponse.ok) {
        const payload = !queueResponse.ok ? queuePayload : intakePayload;
        throw new Error(
          "error" in payload ? payload.error.message : "报修队列暂时无法读取。",
        );
      }
      const nextQueue = queuePayload as StaffRepairQueueResponse;
      setQueue(nextQueue);
      setIntake(intakePayload as StaffRepairIntakeResponse);
      setSelectedRepairId(
        (current) => current ?? nextQueue.rows[0]?.repairId ?? null,
      );
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "报修队列暂时无法读取。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const loadImages = useCallback(async (repairId: string) => {
    const response = await fetch(`/api/v1/repairs/${repairId}/images`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json()) as
      ApiErrorResponse | RepairImageListResponse;
    if (!response.ok) {
      throw new Error(
        "error" in payload ? payload.error.message : "私有图片暂时无法读取。",
      );
    }
    const images = (payload as RepairImageListResponse).images;
    setSelectedImages(images);
    return images;
  }, []);

  const loadDetail = useCallback(async (repairId: string) => {
    const response = await fetch(`/api/v1/repairs/${repairId}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json()) as
      ApiErrorResponse | RepairDetailResponse;
    if (!response.ok) {
      throw new Error(
        "error" in payload ? payload.error.message : "报修详情暂时无法读取。",
      );
    }
    const nextDetail = payload as RepairDetailResponse;
    setDetail(nextDetail);
    return nextDetail;
  }, []);

  useEffect(() => {
    if (!selectedRepairId) {
      setSelectedImages([]);
      setDetail(null);
      return;
    }
    setDetail(null);
    void loadImages(selectedRepairId).catch(() => setSelectedImages([]));
    void loadDetail(selectedRepairId).catch(() => setDetail(null));
  }, [loadDetail, loadImages, selectedRepairId]);

  const selectedRepair = useMemo(
    () => queue?.rows.find((row) => row.repairId === selectedRepairId) ?? null,
    [queue, selectedRepairId],
  );
  const selectedSeat = useMemo(
    () => intake?.seats.find((seat) => seat.id === seatId) ?? null,
    [intake, seatId],
  );

  function openDialog() {
    files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setFiles([]);
    const firstAvailable = intake?.seats.find((seat) => !seat.existingRepair);
    setSeatId(firstAvailable?.id ?? intake?.seats[0]?.id ?? "");
    setDescription("");
    setSampleSelected(false);
    setImageNotice("");
    setDialogFailure("");
    setResult(null);
    setDialogOpen(true);
  }

  function openActionDialog(action: "assign" | "start") {
    actionRetryRef.current = null;
    setActionFailure("");
    setActionDialog(action);
    setAssigneePersonaId(intake?.handlers[0]?.personaId ?? "");
    setActionPriority(detail?.priority ?? "normal");
    setPublicNote(
      action === "assign"
        ? "门店已安排处理人，将尽快检查设备。"
        : "设备已进入检修，受影响预约已自动处理。",
    );
    setInternalNote("");
  }

  async function submitAction() {
    if (
      !selectedRepairId ||
      !actionDialog ||
      actionSubmitting ||
      !publicNote.trim() ||
      !internalNote.trim() ||
      (actionDialog === "assign" && !assigneePersonaId)
    ) {
      return;
    }
    setActionSubmitting(true);
    setActionFailure("");
    try {
      const requestBody =
        actionDialog === "assign"
          ? {
              assigneePersonaId,
              internalNote,
              priority: actionPriority,
              publicNote,
            }
          : { internalNote, publicNote };
      const fingerprint = JSON.stringify({
        action: actionDialog,
        repairId: selectedRepairId,
        requestBody,
      });
      const retry = actionRetryRef.current;
      const idempotencyKey =
        retry?.fingerprint === fingerprint
          ? retry.idempotencyKey
          : crypto.randomUUID();
      actionRetryRef.current = { fingerprint, idempotencyKey };
      const response = await fetch(
        `/api/v1/staff/repairs/${selectedRepairId}/${actionDialog}`,
        {
          body: JSON.stringify(requestBody),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as
        ApiErrorResponse | RepairCommandResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "报修状态暂时无法更新。",
        );
      }
      const command = payload as RepairCommandResponse;
      actionRetryRef.current = null;
      setActionDialog(null);
      await load();
      await loadDetail(selectedRepairId);
      onToast(
        command.action === "assign"
          ? "报修已分派，座位状态保持正常"
          : `已进入处理中，并联动 ${command.affectedReservations.length} 条预约`,
      );
    } catch (error) {
      setActionFailure(
        error instanceof Error ? error.message : "报修状态暂时无法更新。",
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  function openWorkflowDialog(
    action:
      | "claim-spare"
      | "return-spare"
      | "resolution"
      | "verify-success"
      | "verify-failure",
  ) {
    workflowRetryRef.current = null;
    setWorkflowFailure("");
    setWorkflowDialog(action);
    setWorkflowQuantity(1);
    setWorkflowInventoryItemId(
      detail?.spares?.available[0]?.inventoryItemId ?? "",
    );
    setWorkflowUsageId(
      detail?.spares?.usages.find((usage) => usage.consumedQuantity > 0)
        ?.usageId ?? "",
    );
    setWorkflowNote(
      action === "resolution"
        ? "已更换无品牌备用耳机并完成左右声道测试。"
        : action === "verify-success"
          ? "独立复测通过，座位可以恢复使用。"
          : action === "verify-failure"
            ? "复测仍存在右声道无声，退回继续处理。"
            : "",
    );
  }

  async function submitWorkflowAction() {
    if (!selectedRepairId || !workflowDialog || workflowSubmitting) return;

    const endpoint =
      workflowDialog === "claim-spare"
        ? "spares/claim"
        : workflowDialog === "return-spare"
          ? "spares/return"
          : workflowDialog === "resolution"
            ? "resolution"
            : "verification";
    const requestBody =
      workflowDialog === "claim-spare"
        ? {
            inventoryItemId: workflowInventoryItemId,
            quantity: workflowQuantity,
          }
        : workflowDialog === "return-spare"
          ? { quantity: workflowQuantity, usageId: workflowUsageId }
          : workflowDialog === "resolution"
            ? { resolutionNote: workflowNote.trim() }
            : workflowDialog === "verify-success" && !workflowNote.trim()
              ? { outcome: "success" }
              : {
                  outcome:
                    workflowDialog === "verify-success" ? "success" : "failure",
                  reason: workflowNote.trim(),
                };

    if (
      (workflowDialog === "claim-spare" && !workflowInventoryItemId) ||
      (workflowDialog === "return-spare" && !workflowUsageId) ||
      workflowQuantity < 1 ||
      ((workflowDialog === "resolution" ||
        workflowDialog === "verify-failure") &&
        !workflowNote.trim())
    ) {
      return;
    }

    setWorkflowSubmitting(true);
    setWorkflowFailure("");
    try {
      const fingerprint = JSON.stringify({
        action: workflowDialog,
        repairId: selectedRepairId,
        requestBody,
      });
      const retry = workflowRetryRef.current;
      const idempotencyKey =
        retry?.fingerprint === fingerprint
          ? retry.idempotencyKey
          : crypto.randomUUID();
      workflowRetryRef.current = { fingerprint, idempotencyKey };
      const response = await fetch(
        `/api/v1/staff/repairs/${selectedRepairId}/${endpoint}`,
        {
          body: JSON.stringify(requestBody),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as
        | ApiErrorResponse
        | RepairResolutionCommandResponse
        | RepairSpareCommandResponse
        | RepairVerificationCommandResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "报修操作暂时无法完成。",
        );
      }

      workflowRetryRef.current = null;
      setWorkflowDialog(null);
      await load();
      await loadDetail(selectedRepairId);
      onToast(
        workflowDialog === "claim-spare"
          ? "备件已领用，库存流水与报修证据已原子记录"
          : workflowDialog === "return-spare"
            ? "未使用备件已退回库存"
            : workflowDialog === "resolution"
              ? "解决说明已提交，等待独立人员验证"
              : workflowDialog === "verify-success"
                ? "验证成功，报修已关闭且座位恢复正常"
                : "验证失败，报修已退回处理中",
      );
    } catch (error) {
      setWorkflowFailure(
        error instanceof Error ? error.message : "报修操作暂时无法完成。",
      );
    } finally {
      setWorkflowSubmitting(false);
    }
  }

  function chooseFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    const remaining = 3 - files.length - (sampleSelected ? 1 : 0);
    const candidates = Array.from(nextFiles).slice(0, Math.max(0, remaining));
    const accepted = candidates.filter(
      (file) =>
        ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
        file.size > 0 &&
        file.size <= 5 * 1024 * 1024,
    );
    if (accepted.length !== candidates.length || nextFiles.length > remaining) {
      setImageNotice("仅接受最多 3 张 JPEG、PNG 或 WebP，且每张不超过 5 MB。");
    } else {
      setImageNotice("");
    }
    setFiles((current) => [
      ...current,
      ...accepted.map((file) => ({
        file,
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function proxyImage(repairId: string, file: File) {
    const response = await fetch(
      `/api/v1/repairs/${repairId}/images/proxy?filename=${encodeURIComponent(file.name)}`,
      {
        body: file,
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": file.type,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      },
    );
    const payload = (await response.json()) as
      ApiErrorResponse | RepairImageCompletionResponse;
    if (!response.ok) {
      throw new Error(
        "error" in payload ? payload.error.message : "图片净化未完成。",
      );
    }
  }

  async function saveSample(repairId: string) {
    const response = await fetch(`/api/v1/repairs/${repairId}/images/sample`, {
      body: JSON.stringify({ sampleAssetId: "repair-headset-v1" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      method: "POST",
    });
    const payload = (await response.json()) as
      ApiErrorResponse | RepairSampleImageResponse;
    if (!response.ok) {
      throw new Error(
        "error" in payload ? payload.error.message : "样例图未保存。",
      );
    }
  }

  async function retryImages(useSampleFallback = false) {
    if (!result || imageRetrying) return;
    setImageRetrying(true);
    const failedFiles: StaffRepairFile[] = [];
    const failures: string[] = [];
    if (!useSampleFallback) {
      for (const item of files) {
        try {
          await proxyImage(result.repairId, item.file);
          URL.revokeObjectURL(item.previewUrl);
        } catch (error) {
          failedFiles.push(item);
          failures.push(
            error instanceof Error ? error.message : "图片净化未完成。",
          );
        }
      }
    }
    let sampleFailed = false;
    if (useSampleFallback || sampleSelected) {
      try {
        await saveSample(result.repairId);
        if (useSampleFallback) {
          files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        }
      } catch (error) {
        sampleFailed = true;
        if (useSampleFallback) failedFiles.push(...files);
        failures.push(
          error instanceof Error ? error.message : "样例图未保存。",
        );
      }
    }
    setFiles(failedFiles);
    setSampleSelected(sampleFailed);
    const images = await loadImages(result.repairId).catch(() => []);
    setImageNotice(
      failures.length > 0
        ? `${failures[0]} 文字报修和既有净化图片不受影响。`
        : `安全图片已保存，当前共 ${images.length} 张。`,
    );
    setImageRetrying(false);
  }

  async function submitRepair() {
    if (!selectedSeat || description.trim().length < 1 || submitting) return;
    setSubmitting(true);
    setDialogFailure("");
    try {
      const response = await fetch("/api/v1/staff/repairs", {
        body: JSON.stringify({ description, seatId: selectedSeat.id }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload = (await response.json()) as
        ApiErrorResponse | RepairCreatedResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "报修暂时无法保存。",
        );
      }
      const created = payload as RepairCreatedResponse;
      const imageFailures: string[] = [];
      const failedFiles: StaffRepairFile[] = [];
      for (const item of files) {
        try {
          await proxyImage(created.repairId, item.file);
          URL.revokeObjectURL(item.previewUrl);
        } catch (error) {
          failedFiles.push(item);
          imageFailures.push(
            error instanceof Error ? error.message : "图片净化未完成。",
          );
        }
      }
      let sampleFailed = false;
      if (sampleSelected) {
        try {
          await saveSample(created.repairId);
        } catch (error) {
          sampleFailed = true;
          imageFailures.push(
            error instanceof Error ? error.message : "样例图未保存。",
          );
        }
      }
      setFiles(failedFiles);
      setSampleSelected(sampleFailed);
      setResult(created);
      setSelectedRepairId(created.repairId);
      setImageNotice(
        created.duplicate
          ? "该座位已有未关闭报修，已打开现有记录。"
          : imageFailures.length > 0
            ? `文字报修已保存；${imageFailures[0]} 原文件未保留。`
            : "文字报修已保存；图片已通过私有净化流程。",
      );
      await load();
      await loadImages(created.repairId).catch(() => []);
      onToast(created.duplicate ? "已打开现有报修" : "新报修已进入门店队列");
    } catch (error) {
      setDialogFailure(
        error instanceof Error
          ? error.message
          : "报修暂时无法保存，输入内容仍保留。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="staff-repair-main" data-testid="staff-repair-queue">
      <header className="staff-repair-title-row">
        <div>
          <span className="shell-eyebrow">WEB-S07 · REPAIR OPERATIONS</span>
          <h1>报修处理</h1>
          <p>
            {queue?.store.displayName ?? "当前门店"} · 分派、维护联动与退款证据
          </p>
        </div>
        <div>
          <button disabled={loading} onClick={() => void load()} type="button">
            <ArrowClockwise /> {loading ? "刷新中" : "刷新"}
          </button>
          <button className="is-primary" onClick={openDialog} type="button">
            <Plus /> 新建座位报修
          </button>
        </div>
      </header>

      {failure ? (
        <section className="staff-repair-feedback is-error" role="alert">
          <Warning />
          <span>
            <strong>队列读取失败</strong>
            {failure}
          </span>
          <button onClick={() => void load()} type="button">
            重试
          </button>
        </section>
      ) : null}

      <section className="staff-repair-layout">
        <div className="staff-repair-queue-panel">
          <div className="staff-repair-summary">
            <span>
              <strong>{queue?.rows.length ?? 0}</strong> 全部报修
            </span>
            <span>
              <strong>
                {queue?.rows.filter((row) => row.status === "new").length ?? 0}
              </strong>{" "}
              待分派
            </span>
            <span>
              <strong>
                {queue?.rows.filter((row) => row.status === "verification")
                  .length ?? 0}
              </strong>{" "}
              待验证
            </span>
          </div>
          <div className="staff-repair-table" role="table">
            <div className="staff-repair-table-head" role="row">
              <span>优先级</span>
              <span>座位 / 故障</span>
              <span>状态</span>
              <span>等待</span>
              <span />
            </div>
            {queue?.rows.length ? (
              queue.rows.map((row) => (
                <button
                  className={
                    selectedRepairId === row.repairId ? "is-selected" : ""
                  }
                  key={row.repairId}
                  onClick={() => setSelectedRepairId(row.repairId)}
                  role="row"
                  type="button"
                >
                  <span className={`is-${row.priority}`}>
                    {priorityLabels[row.priority]}
                  </span>
                  <span>
                    <strong>
                      {row.seat.code} · {row.machineProfile.displayName}
                    </strong>
                    <small>{row.description}</small>
                  </span>
                  <span>{statusLabels[row.status]}</span>
                  <span>{row.waitingMinutes} 分钟</span>
                  <CaretRight />
                </button>
              ))
            ) : (
              <div className="staff-repair-empty">
                <Wrench weight="duotone" />
                <strong>本店当前没有报修</strong>
                <span>主动创建时只能选择本店明确座位，机型自动带出。</span>
                <button onClick={openDialog} type="button">
                  <Plus /> 创建第一条报修
                </button>
              </div>
            )}
          </div>
        </div>

        <aside className="staff-repair-inspector is-detail">
          <span className="shell-eyebrow">
            报修详情 · {role === "manager" ? "店长" : "店员"}
          </span>
          {selectedRepair && detail ? (
            <>
              <div className="staff-repair-inspector-title">
                <Wrench />
                <span>
                  <strong>{selectedRepair.seat.code}</strong>
                  <small>{selectedRepair.machineProfile.displayName}</small>
                </span>
                <em>{statusLabels[detail.status]}</em>
              </div>
              <p>{detail.description}</p>
              {detail.actions.canAssign ||
              detail.actions.canStart ||
              detail.actions.canClaimSpare ||
              detail.actions.canReturnSpare ||
              detail.actions.canSubmitResolution ||
              detail.actions.canVerify ? (
                <div className="staff-repair-actions">
                  {detail.actions.canAssign ? (
                    <button
                      className="is-primary"
                      onClick={() => openActionDialog("assign")}
                      type="button"
                    >
                      <ShieldCheck /> 分派报修
                    </button>
                  ) : null}
                  {detail.actions.canStart ? (
                    <button
                      className="is-primary"
                      onClick={() => openActionDialog("start")}
                      type="button"
                    >
                      <Wrench /> 开始处理
                    </button>
                  ) : null}
                  {detail.actions.canClaimSpare ? (
                    <button
                      onClick={() => openWorkflowDialog("claim-spare")}
                      type="button"
                    >
                      <Package /> 领用备件
                    </button>
                  ) : null}
                  {detail.actions.canReturnSpare &&
                  detail.spares?.usages.some(
                    (usage) => usage.consumedQuantity > 0,
                  ) ? (
                    <button
                      onClick={() => openWorkflowDialog("return-spare")}
                      type="button"
                    >
                      <ArrowCounterClockwise /> 退回未用备件
                    </button>
                  ) : null}
                  {detail.actions.canSubmitResolution ? (
                    <button
                      className="is-primary"
                      onClick={() => openWorkflowDialog("resolution")}
                      type="button"
                    >
                      <CheckCircle /> 提交解决说明
                    </button>
                  ) : null}
                  {detail.actions.canVerify ? (
                    <>
                      <button
                        className="is-primary"
                        onClick={() => openWorkflowDialog("verify-success")}
                        type="button"
                      >
                        <CheckCircle /> 验证成功并关闭
                      </button>
                      <button
                        className="is-danger"
                        onClick={() => openWorkflowDialog("verify-failure")}
                        type="button"
                      >
                        <Warning /> 验证失败并退回
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {detail.status === "processing" ||
              detail.status === "verification" ? (
                <section className="staff-repair-maintenance-notice">
                  <Warning />
                  <span>
                    <strong>座位维护联动已生效</strong>
                    {detail.seat.code}{" "}
                    已进入维护；预约没有自动换座，退款按价格片段计算。
                    {detail.status === "verification"
                      ? " 解决说明已提交，须由非原处理人复测。"
                      : ""}
                  </span>
                </section>
              ) : null}
              <h3>摘要</h3>
              <dl>
                <div>
                  <dt>来源</dt>
                  <dd>
                    {selectedRepair.source === "customer" ? "顾客" : "本店店员"}
                  </dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>{priorityLabels[detail.priority]} · 仅用于排序与告警</dd>
                </div>
                <div>
                  <dt>处理人</dt>
                  <dd>{detail.assignedTo?.displayName ?? "未分派"}</dd>
                </div>
                <div>
                  <dt>座位影响</dt>
                  <dd>
                    {detail.seat.operationalStatus === "maintenance"
                      ? "维护中"
                      : detail.status === "closed"
                        ? "正常（验证后已恢复）"
                        : "正常（尚未开始处理）"}
                  </dd>
                </div>
              </dl>
              {selectedImages.length > 0 ? (
                <section className="staff-repair-detail-section">
                  <h3>顾客描述与净化图片</h3>
                  <div className="staff-repair-inspector-images">
                    {selectedImages.map((image) => (
                      <figure key={image.imageId}>
                        <img
                          alt={
                            image.source === "sample"
                              ? "内置耳机故障样例图"
                              : "已净化故障图片"
                          }
                          src={
                            image.source === "sample"
                              ? repairSample.src
                              : image.readUrl
                          }
                        />
                        <figcaption>
                          {image.source === "sample"
                            ? "内置样例"
                            : "私有净化图"}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              ) : null}
              <section className="staff-repair-detail-section">
                <h3>座位与预约影响</h3>
                {detail.impacts.length > 0 ? (
                  <div className="staff-repair-impact-list">
                    {detail.impacts.map((impact) => (
                      <article key={impact.reservationId}>
                        <span>
                          <strong>
                            {impact.customerDisplayName ?? "当前顾客"} ·{" "}
                            {reservationStatusLabels[impact.beforeStatus]}
                          </strong>
                          <small>
                            {new Date(
                              impact.window.startsAt,
                            ).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            –
                            {new Date(impact.window.endsAt).toLocaleTimeString(
                              "zh-CN",
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </small>
                        </span>
                        <em>
                          {impact.outcome === "completed"
                            ? "提前完成"
                            : "已取消"}
                          <small>
                            模拟退款 ¥
                            {(impact.simulatedRefundCents / 100).toFixed(2)}
                            {impact.couponRestored ? " · 券已恢复" : ""}
                          </small>
                        </em>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="staff-repair-muted">
                    开始处理前不改变座位或预约；确认后才在同一事务计算影响。
                  </p>
                )}
              </section>
              {detail.spares ? (
                <section className="staff-repair-detail-section">
                  <h3>备件领用与退回</h3>
                  {detail.status !== "closed" ? (
                    <div className="staff-repair-spare-summary">
                      {detail.spares.available.map((item) => (
                        <article key={item.inventoryItemId}>
                          <Package />
                          <span>
                            <strong>{item.displayName}</strong>
                            <small>
                              可用 {item.availableQuantity} · 账面
                              {item.onHandQuantity}
                            </small>
                          </span>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  {detail.spares.usages.length > 0 ? (
                    <div className="staff-repair-spare-usages">
                      {detail.spares.usages.map((usage) => (
                        <article key={usage.usageId}>
                          <div>
                            <strong>{usage.inventoryItem.displayName}</strong>
                            <span>
                              领用 {usage.quantity} · 退回{" "}
                              {usage.returnedQuantity} · 消耗{" "}
                              {usage.consumedQuantity}
                            </span>
                          </div>
                          <small>
                            流水 {usage.movementId.slice(0, 8)} · 业务发生
                            {new Date(usage.claimedAt).toLocaleString(
                              "zh-CN",
                            )}{" "}
                            · 入库记录
                            {new Date(usage.recordedAt).toLocaleString("zh-CN")}
                          </small>
                          {usage.returns.map((returned) => (
                            <small key={returned.returnId}>
                              退回 {returned.quantity} · 流水
                              {returned.movementId.slice(0, 8)} ·
                              {returned.returnedBy.displayName} · 业务发生
                              {new Date(returned.returnedAt).toLocaleString(
                                "zh-CN",
                              )}{" "}
                              · 入库记录
                              {new Date(returned.recordedAt).toLocaleString(
                                "zh-CN",
                              )}
                            </small>
                          ))}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="staff-repair-muted">尚未领用维修备件。</p>
                  )}
                </section>
              ) : null}
              {detail.resolution ? (
                <section className="staff-repair-detail-section staff-repair-resolution">
                  <h3>解决说明</h3>
                  <CheckCircle />
                  <p>{detail.resolution.note}</p>
                  <small>
                    {detail.resolution.submittedBy?.displayName ?? "门店人员"} ·
                    {new Date(detail.resolution.submittedAt).toLocaleString(
                      "zh-CN",
                    )}
                  </small>
                </section>
              ) : null}
              {detail.latestVerification ? (
                <section
                  className={`staff-repair-detail-section staff-repair-verification is-${detail.latestVerification.outcome}`}
                >
                  <h3>
                    {detail.latestVerification.outcome === "success"
                      ? "最近验证 · 成功"
                      : "最近验证 · 失败"}
                  </h3>
                  {detail.latestVerification.outcome === "success" ? (
                    <CheckCircle />
                  ) : (
                    <Warning />
                  )}
                  <p>{detail.latestVerification.reason}</p>
                  <small>
                    {detail.latestVerification.verifiedBy?.displayName ??
                      "独立验证人"}{" "}
                    ·
                    {new Date(
                      detail.latestVerification.verifiedAt,
                    ).toLocaleString("zh-CN")}
                  </small>
                </section>
              ) : null}
              <section className="staff-repair-detail-section">
                <h3>顾客可见说明</h3>
                {detail.publicUpdates.length > 0 ? (
                  <ol className="staff-repair-timeline">
                    {detail.publicUpdates.map((update) => (
                      <li key={`${update.type}-${update.occurredAt}`}>
                        <Clock />
                        <span>
                          <strong>{update.note}</strong>
                          <small>
                            {new Date(update.occurredAt).toLocaleString(
                              "zh-CN",
                            )}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="staff-repair-muted">尚无公开处理动态。</p>
                )}
              </section>
              {detail.internal ? (
                <section className="staff-repair-detail-section is-internal">
                  <h3>
                    <Lock /> 内部说明与审计证据
                  </h3>
                  {detail.internal.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                  <ol className="staff-repair-timeline is-compact">
                    {detail.internal.events.map((event) => (
                      <li key={`${event.type}-${event.occurredAt}`}>
                        <ShieldCheck />
                        <span>
                          <strong>
                            {event.type} · {event.actor?.displayName ?? "系统"}
                          </strong>
                          <small>
                            业务发生
                            {new Date(event.occurredAt).toLocaleString(
                              "zh-CN",
                            )}{" "}
                            · 入库记录
                            {new Date(event.recordedAt).toLocaleString("zh-CN")}
                          </small>
                        </span>
                      </li>
                    ))}
                    {detail.internal.audits.map((audit) => (
                      <li key={`${audit.action}-${audit.occurredAt}`}>
                        <ShieldCheck />
                        <span>
                          <strong>
                            {audit.action} ·{" "}
                            {audit.actor?.displayName ?? "系统"}
                          </strong>
                          <small>
                            {audit.result} · 业务发生
                            {new Date(audit.occurredAt).toLocaleString(
                              "zh-CN",
                            )}{" "}
                            · 入库记录
                            {new Date(audit.recordedAt).toLocaleString("zh-CN")}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </>
          ) : selectedRepair ? (
            <div className="staff-repair-inspector-empty">
              <ArrowClockwise />
              <span>正在读取报修详情与权限…</span>
            </div>
          ) : (
            <div className="staff-repair-inspector-empty">
              <Info />
              <span>选择一条报修查看上下文。</span>
            </div>
          )}
        </aside>
      </section>

      {workflowDialog ? (
        <div className="staff-repair-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="staff-repair-workflow-title"
            aria-modal="true"
            className="staff-repair-dialog is-action"
            role="dialog"
          >
            <header>
              <div>
                <span className="shell-eyebrow">REPAIR WORKFLOW</span>
                <h2 id="staff-repair-workflow-title">
                  {workflowDialog === "claim-spare"
                    ? "领用维修备件"
                    : workflowDialog === "return-spare"
                      ? "退回未使用备件"
                      : workflowDialog === "resolution"
                        ? "提交解决说明"
                        : workflowDialog === "verify-success"
                          ? "验证成功并关闭"
                          : "验证失败并退回"}
                </h2>
              </div>
              <button
                aria-label="关闭报修操作"
                onClick={() => setWorkflowDialog(null)}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className="staff-repair-dialog-body">
              {workflowDialog === "claim-spare" ? (
                <div className="staff-repair-action-fields is-split">
                  <label>
                    <span>本店可用备件</span>
                    <select
                      onChange={(event) =>
                        setWorkflowInventoryItemId(event.target.value)
                      }
                      value={workflowInventoryItemId}
                    >
                      {detail?.spares?.available.map((item) => (
                        <option
                          disabled={item.availableQuantity < 1}
                          key={item.inventoryItemId}
                          value={item.inventoryItemId}
                        >
                          {item.displayName} · 可用 {item.availableQuantity}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>领用数量</span>
                    <input
                      min={1}
                      onChange={(event) =>
                        setWorkflowQuantity(Number(event.target.value))
                      }
                      type="number"
                      value={workflowQuantity}
                    />
                  </label>
                </div>
              ) : workflowDialog === "return-spare" ? (
                <div className="staff-repair-action-fields is-split">
                  <label>
                    <span>待退回领用记录</span>
                    <select
                      onChange={(event) =>
                        setWorkflowUsageId(event.target.value)
                      }
                      value={workflowUsageId}
                    >
                      {detail?.spares?.usages
                        .filter((usage) => usage.consumedQuantity > 0)
                        .map((usage) => (
                          <option key={usage.usageId} value={usage.usageId}>
                            {usage.inventoryItem.displayName} · 可退
                            {usage.consumedQuantity}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span>退回数量</span>
                    <input
                      min={1}
                      onChange={(event) =>
                        setWorkflowQuantity(Number(event.target.value))
                      }
                      type="number"
                      value={workflowQuantity}
                    />
                  </label>
                </div>
              ) : (
                <div className="staff-repair-action-fields">
                  <label>
                    <span>
                      {workflowDialog === "resolution"
                        ? "解决说明"
                        : workflowDialog === "verify-success"
                          ? "独立复测结论（成功可选）"
                          : "独立复测结论"}
                      <small>
                        {workflowNote.length}/
                        {workflowDialog === "resolution" ? 500 : 200}
                      </small>
                    </span>
                    <textarea
                      autoFocus
                      maxLength={workflowDialog === "resolution" ? 500 : 200}
                      onChange={(event) => setWorkflowNote(event.target.value)}
                      value={workflowNote}
                    />
                  </label>
                </div>
              )}
              {workflowDialog === "verify-success" ? (
                <section className="staff-repair-start-warning is-success">
                  <CheckCircle />
                  <span>
                    <strong>成功后立即关闭</strong>
                    座位会在同一事务恢复正常，关闭后的报修不能重新打开。
                  </span>
                </section>
              ) : workflowDialog === "verify-failure" ? (
                <section className="staff-repair-start-warning">
                  <Warning />
                  <span>
                    <strong>失败后退回处理中</strong>
                    座位继续保持维护，可再次领退备件并提交新的解决说明。
                  </span>
                </section>
              ) : null}
              {workflowFailure ? (
                <div className="staff-repair-existing is-error" role="alert">
                  <Warning /> {workflowFailure}
                </div>
              ) : null}
            </div>
            <footer>
              <span>
                <Lock /> 每次提交使用独立幂等键并保留双时钟证据
              </span>
              <div>
                <button onClick={() => setWorkflowDialog(null)} type="button">
                  取消
                </button>
                <button
                  className="is-primary"
                  disabled={
                    workflowSubmitting ||
                    workflowQuantity < 1 ||
                    (workflowDialog === "claim-spare" &&
                      !workflowInventoryItemId) ||
                    (workflowDialog === "return-spare" && !workflowUsageId) ||
                    ((workflowDialog === "resolution" ||
                      workflowDialog === "verify-failure") &&
                      !workflowNote.trim())
                  }
                  onClick={() => void submitWorkflowAction()}
                  type="button"
                >
                  {workflowDialog === "claim-spare" ? (
                    <Package />
                  ) : workflowDialog === "return-spare" ? (
                    <ArrowCounterClockwise />
                  ) : (
                    <CheckCircle />
                  )}
                  {workflowSubmitting ? "正在提交…" : "确认提交"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {actionDialog ? (
        <div className="staff-repair-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="staff-repair-action-title"
            aria-modal="true"
            className="staff-repair-dialog is-action"
            role="dialog"
          >
            <header>
              <div>
                <span className="shell-eyebrow">
                  {actionDialog === "assign"
                    ? "ASSIGN REPAIR"
                    : "START MAINTENANCE"}
                </span>
                <h2 id="staff-repair-action-title">
                  {actionDialog === "assign" ? "分派报修" : "确认开始处理"}
                </h2>
              </div>
              <button
                aria-label="关闭操作确认"
                onClick={() => setActionDialog(null)}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className="staff-repair-dialog-body">
              {actionDialog === "start" ? (
                <section className="staff-repair-start-warning">
                  <Warning />
                  <span>
                    <strong>此操作会立即产生业务影响</strong>
                    座位将进入维护；当前业务时间起的待确认、已确认和已到店预约会取消，使用中预约会提前完成。系统不会自动换座，并会按规则处理模拟退款与体验券。
                  </span>
                </section>
              ) : (
                <p className="staff-repair-muted">
                  分派只改变处理人与队列优先级，座位仍保持正常；优先级不代表处理时限承诺。
                </p>
              )}
              {actionDialog === "assign" ? (
                <div className="staff-repair-action-fields is-split">
                  <label>
                    <span>本店处理人</span>
                    <select
                      onChange={(event) =>
                        setAssigneePersonaId(event.target.value)
                      }
                      value={assigneePersonaId}
                    >
                      {intake?.handlers.map((handler) => (
                        <option
                          key={handler.personaId}
                          value={handler.personaId}
                        >
                          {handler.displayName} ·{" "}
                          {handler.role === "manager" ? "店长" : "店员"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>队列优先级</span>
                    <select
                      onChange={(event) =>
                        setActionPriority(
                          event.target.value as "normal" | "high" | "urgent",
                        )
                      }
                      value={actionPriority}
                    >
                      <option value="normal">普通</option>
                      <option value="high">较高</option>
                      <option value="urgent">紧急</option>
                    </select>
                  </label>
                </div>
              ) : null}
              <div className="staff-repair-action-fields">
                <label>
                  <span>
                    顾客可见说明 <small>{publicNote.length}/500</small>
                  </span>
                  <textarea
                    maxLength={500}
                    onChange={(event) => setPublicNote(event.target.value)}
                    value={publicNote}
                  />
                </label>
                <label>
                  <span>
                    内部处理说明 <small>{internalNote.length}/500</small>
                  </span>
                  <textarea
                    autoFocus
                    maxLength={500}
                    onChange={(event) => setInternalNote(event.target.value)}
                    placeholder="仅门店角色可见；不得填写真实个人信息"
                    value={internalNote}
                  />
                </label>
              </div>
              {actionFailure ? (
                <div className="staff-repair-existing is-error" role="alert">
                  <Warning /> {actionFailure}
                </div>
              ) : null}
            </div>
            <footer>
              <span>
                <Lock /> 公开说明与内部说明分区保存
              </span>
              <div>
                <button onClick={() => setActionDialog(null)} type="button">
                  取消
                </button>
                <button
                  className="is-primary"
                  disabled={
                    actionSubmitting ||
                    !publicNote.trim() ||
                    !internalNote.trim() ||
                    (actionDialog === "assign" && !assigneePersonaId)
                  }
                  onClick={() => void submitAction()}
                  type="button"
                >
                  {actionDialog === "assign" ? <ShieldCheck /> : <Wrench />}
                  {actionSubmitting
                    ? "正在提交…"
                    : actionDialog === "assign"
                      ? "确认分派"
                      : "确认影响并开始"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {dialogOpen ? (
        <div className="staff-repair-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="staff-repair-dialog-title"
            aria-modal="true"
            className="staff-repair-dialog"
            role="dialog"
          >
            <header>
              <div>
                <span className="shell-eyebrow">CREATE STORE REPAIR</span>
                <h2 id="staff-repair-dialog-title">新建座位报修</h2>
              </div>
              <button
                aria-label="关闭新建报修"
                onClick={() => setDialogOpen(false)}
                type="button"
              >
                <X />
              </button>
            </header>
            {result ? (
              <div className="staff-repair-dialog-result">
                <CheckCircle weight="fill" />
                <h3>
                  {result.duplicate ? "已打开现有报修" : "报修已进入队列"}
                </h3>
                <p>{imageNotice}</p>
                <dl>
                  <div>
                    <dt>座位</dt>
                    <dd>{result.seat.code}</dd>
                  </div>
                  <div>
                    <dt>机型</dt>
                    <dd>{result.machineProfile.displayName}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>新建 · 座位仍正常</dd>
                  </div>
                </dl>
                <button
                  className="is-primary"
                  onClick={() => setDialogOpen(false)}
                  type="button"
                >
                  查看队列
                </button>
                {files.length > 0 || sampleSelected ? (
                  <div className="staff-repair-result-recovery">
                    <span>
                      图片失败不会影响文字报修；可重试当前单图或改用内置样例。
                    </span>
                    <button
                      disabled={imageRetrying}
                      onClick={() => void retryImages()}
                      type="button"
                    >
                      {imageRetrying ? "净化中…" : "重试未保存图片"}
                    </button>
                    <button
                      disabled={imageRetrying}
                      onClick={() => void retryImages(true)}
                      type="button"
                    >
                      改用内置样例
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="staff-repair-dialog-body">
                  <div className="staff-repair-seat-fields">
                    <label>
                      <span>本店座位</span>
                      <select
                        onChange={(event) => {
                          setSeatId(event.target.value);
                          setDialogFailure("");
                        }}
                        value={seatId}
                      >
                        {intake?.seats.map((seat) => (
                          <option key={seat.id} value={seat.id}>
                            {seat.code}
                            {seat.existingRepair ? " · 已有未关闭报修" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <span>自动带出机型</span>
                      <strong>
                        {selectedSeat?.machineProfile.displayName ?? "—"}
                      </strong>
                      <small>
                        {selectedSeat?.area.displayName ?? "请选择座位"}
                      </small>
                    </div>
                  </div>
                  {selectedSeat?.existingRepair ? (
                    <div className="staff-repair-existing">
                      <Warning />
                      <span>
                        <strong>该座位已有未关闭报修</strong>
                        提交后会打开现有报修，不会创建重复记录。
                      </span>
                    </div>
                  ) : null}
                  <label className="staff-repair-description">
                    <span>
                      <strong>故障描述</strong>
                      <small>{description.length} / 500</small>
                    </span>
                    <textarea
                      maxLength={500}
                      onChange={(event) => {
                        setDescription(event.target.value);
                        setDialogFailure("");
                      }}
                      placeholder="例如：显示器间歇闪烁"
                      rows={4}
                      value={description}
                    />
                    <em>
                      <Lock /> 请勿填写真实个人信息
                    </em>
                  </label>
                  <section className="staff-repair-image-field">
                    <div>
                      <span>
                        <strong>故障图片（可选）</strong>
                        <small>最多 3 张 · 单图代理同样执行净化</small>
                      </span>
                      <ShieldCheck />
                    </div>
                    {files.length > 0 || sampleSelected ? (
                      <div className="staff-repair-previews">
                        {files.map((item) => (
                          <figure key={item.id}>
                            <img
                              alt="待净化故障图片预览"
                              src={item.previewUrl}
                            />
                            <button
                              aria-label="删除待上传图片"
                              onClick={() => removeFile(item.id)}
                              type="button"
                            >
                              <Trash />
                            </button>
                            <figcaption>待净化</figcaption>
                          </figure>
                        ))}
                        {sampleSelected ? (
                          <figure>
                            <img
                              alt="耳机故障内置样例图"
                              src={repairSample.src}
                            />
                            <button
                              aria-label="删除内置样例图"
                              onClick={() => setSampleSelected(false)}
                              type="button"
                            >
                              <Trash />
                            </button>
                            <figcaption>内置样例</figcaption>
                          </figure>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="staff-repair-image-buttons">
                      <label
                        className={
                          files.length + (sampleSelected ? 1 : 0) >= 3
                            ? "is-disabled"
                            : ""
                        }
                      >
                        <Camera />
                        选择图片
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          disabled={
                            files.length + (sampleSelected ? 1 : 0) >= 3
                          }
                          multiple
                          onChange={(event) => {
                            chooseFiles(event.target.files);
                            event.target.value = "";
                          }}
                          type="file"
                        />
                      </label>
                      <button
                        disabled={
                          sampleSelected ||
                          files.length + (sampleSelected ? 1 : 0) >= 3
                        }
                        onClick={() => {
                          setSampleSelected(true);
                          setImageNotice(
                            "已选择内置虚构样例图。图片权限不是创建报修的前提。",
                          );
                        }}
                        type="button"
                      >
                        <ImageSquare />
                        使用样例图
                      </button>
                    </div>
                    <button
                      className="staff-repair-permission"
                      onClick={() =>
                        setImageNotice(
                          "相册权限被拒绝也可继续文字报修，未经净化的文件不会保存。",
                        )
                      }
                      type="button"
                    >
                      图片权限被拒绝？
                    </button>
                    {imageNotice ? (
                      <div className="staff-repair-image-notice">
                        <Info />
                        {imageNotice}
                      </div>
                    ) : null}
                  </section>
                  {dialogFailure ? (
                    <div
                      className="staff-repair-existing is-error"
                      role="alert"
                    >
                      <Warning />
                      <span>
                        <strong>报修尚未保存</strong>
                        {dialogFailure}
                      </span>
                    </div>
                  ) : null}
                </div>
                <footer>
                  <span>图片失败不阻塞文字报修</span>
                  <div>
                    <button onClick={() => setDialogOpen(false)} type="button">
                      取消
                    </button>
                    <button
                      className="is-primary"
                      disabled={
                        submitting ||
                        !selectedSeat ||
                        description.trim().length < 1
                      }
                      onClick={() => void submitRepair()}
                      type="button"
                    >
                      <Wrench />
                      {submitting ? "正在保存…" : "创建报修"}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
