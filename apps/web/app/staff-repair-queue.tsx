"use client";

import {
  ArrowClockwise,
  Camera,
  CaretRight,
  CheckCircle,
  Clock,
  ImageSquare,
  Info,
  Lock,
  Plus,
  ShieldCheck,
  Trash,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ApiErrorResponse,
  RepairCreatedResponse,
  RepairImageCompletionResponse,
  RepairImageListResponse,
  RepairImageSaved,
  RepairSampleImageResponse,
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

export function StaffRepairQueue({
  csrfToken,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  const [queue, setQueue] = useState<StaffRepairQueueResponse | null>(null);
  const [intake, setIntake] = useState<StaffRepairIntakeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<
    ReadonlyArray<RepairImageSaved>
  >([]);
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

  useEffect(() => {
    if (!selectedRepairId) {
      setSelectedImages([]);
      return;
    }
    void loadImages(selectedRepairId).catch(() => setSelectedImages([]));
  }, [loadImages, selectedRepairId]);

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
          <span className="shell-eyebrow">WEB-S06 · STORE-SCOPED REPAIRS</span>
          <h1>报修队列</h1>
          <p>
            {queue?.store.displayName ?? "当前门店"} · 座位设备报修与净化图片
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

        <aside className="staff-repair-inspector">
          <span className="shell-eyebrow">当前选中</span>
          {selectedRepair ? (
            <>
              <div className="staff-repair-inspector-title">
                <Wrench />
                <span>
                  <strong>{selectedRepair.seat.code}</strong>
                  <small>{selectedRepair.machineProfile.displayName}</small>
                </span>
                <em>{statusLabels[selectedRepair.status]}</em>
              </div>
              <p>{selectedRepair.description}</p>
              <dl>
                <div>
                  <dt>来源</dt>
                  <dd>
                    {selectedRepair.source === "customer" ? "顾客" : "本店店员"}
                  </dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>{priorityLabels[selectedRepair.priority]}</dd>
                </div>
                <div>
                  <dt>等待</dt>
                  <dd>{selectedRepair.waitingMinutes} 分钟</dd>
                </div>
                <div>
                  <dt>座位影响</dt>
                  <dd>尚未进入维护</dd>
                </div>
              </dl>
              <section>
                <Clock />
                <span>
                  <strong>新建 · 等待分派</strong>
                  开始处理前不会改变座位运营状态。
                </span>
              </section>
              {selectedImages.length > 0 ? (
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
                        {image.source === "sample" ? "内置样例" : "私有净化图"}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="staff-repair-inspector-empty">
              <Info />
              <span>选择一条报修查看上下文。</span>
            </div>
          )}
        </aside>
      </section>

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
