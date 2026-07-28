import { CloudCheckIcon, KeyIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { StatusPill } from "../../design/primitives.js";
import {
  configurePilotProvider,
  updatePilotDeploymentEndpoint,
} from "../../pilot/api.js";
import { usePilotOptional } from "../../pilot/context.js";

/**
 * Deployment endpoint and model provider — organization-wide service wiring.
 *
 * This lives on the governance surface rather than in personal Settings: it is
 * one configuration for the whole organization, and only an admin can change
 * it. Everyone else sees the effective values read-only.
 */
export function OrganizationServiceSettings({
  canManage,
}: {
  canManage: boolean;
}) {
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const organization = pilot?.bootstrap.data?.organization;
  const deploymentEndpointManaged =
    pilot?.bootstrap.data?.deploymentEndpointManaged ?? false;
  const developmentIdentityId =
    pilot?.bootstrap.data?.authMode === "development_identity"
      ? pilot.identityId
      : undefined;

  const [editingDeployment, setEditingDeployment] = useState(false);
  const [deploymentEndpoint, setDeploymentEndpoint] = useState("");
  const [editingProvider, setEditingProvider] = useState(false);
  const [providerEndpoint, setProviderEndpoint] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [providerModel, setProviderModel] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pilot"] });
  const updateDeployment = useMutation({
    mutationFn: () =>
      updatePilotDeploymentEndpoint(deploymentEndpoint, developmentIdentityId),
    onSuccess: async () => {
      setEditingDeployment(false);
      await refresh();
    },
  });
  const configureProvider = useMutation({
    mutationFn: () =>
      configurePilotProvider(pilot!.identityId!, {
        endpoint: providerEndpoint,
        apiKey: providerKey,
        defaultModel: providerModel,
      }),
    onSuccess: async () => {
      setProviderKey("");
      setEditingProvider(false);
      await refresh();
    },
  });

  function openProviderEditor() {
    setProviderEndpoint(
      organization?.provider.endpoint ?? "https://api.openai.com/v1",
    );
    setProviderModel(organization?.provider.defaultModel ?? "gpt-5.4");
    setProviderKey("");
    setEditingProvider(true);
  }

  return (
    <div className="mt-[26px] flex flex-col gap-[30px]">
      <div>
        <strong className="text-[14px] font-[620]">Intero 服务</strong>
        <p className="mt-2 max-w-[580px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          整个组织连接的 Intero 云服务部署。改动会在校验通过后对所有成员生效。
        </p>
        <div
          className="mt-3.5 rounded-[13px] border border-line bg-panel2 px-4 py-[15px]"
          data-testid="pilot-cloud-settings"
        >
          <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px]">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-green">
              <CloudCheckIcon size={16} />
            </span>
            <span className="grid min-w-0">
              <strong className="text-[12.5px] font-[620]">部署地址</strong>
              <small className="mt-1 truncate font-mono text-[11px] text-ink-muted">
                {organization?.deploymentBaseUrl ?? "尚未配置 Intero 部署"}
              </small>
            </span>
            {canManage && !deploymentEndpointManaged ? (
              <button
                type="button"
                data-testid="deployment-endpoint-edit"
                onClick={() => {
                  setDeploymentEndpoint(organization?.deploymentBaseUrl ?? "");
                  setEditingDeployment(true);
                }}
                className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong"
              >
                修改并重新校验
              </button>
            ) : (
              <StatusPill tone="faint" size="sm">
                {deploymentEndpointManaged ? "由部署配置管理" : "继承组织配置"}
              </StatusPill>
            )}
          </div>
          {editingDeployment ? (
            <div className="mt-4 flex gap-2 border-t border-line pt-4">
              <input
                type="url"
                value={deploymentEndpoint}
                onChange={(event) => setDeploymentEndpoint(event.target.value)}
                data-testid="deployment-endpoint-input"
                className="h-9 min-w-0 flex-1 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none focus:border-accent-strong"
              />
              <button
                type="button"
                disabled={
                  !deploymentEndpoint.trim() || updateDeployment.isPending
                }
                onClick={() => updateDeployment.mutate()}
                className="h-9 cursor-pointer rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:opacity-50"
              >
                {updateDeployment.isPending ? "校验中…" : "校验并保存"}
              </button>
              <button
                type="button"
                onClick={() => setEditingDeployment(false)}
                className="h-9 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[12px] text-ink-muted"
              >
                取消
              </button>
            </div>
          ) : null}
          {updateDeployment.isError ? (
            <p className="mt-3 text-[11px] text-danger" role="alert">
              无法通过该地址访问 Intero 健康检查，配置未保存。
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <strong className="text-[14px] font-[620]">模型服务</strong>
        <p className="mt-2 max-w-[580px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          替身和 Agent 工作摘要都走这一个模型服务。密钥只保存在 Intero
          服务端，不会返回给浏览器或团队成员。
        </p>
        <div
          className="mt-3.5 rounded-[13px] border border-line bg-panel2 px-4 py-[15px]"
          data-testid="pilot-provider-settings"
        >
          <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px]">
            <span
              className={[
                "grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise",
                organization?.provider.configured
                  ? "text-green"
                  : "text-ink-muted",
              ].join(" ")}
            >
              <KeyIcon size={16} />
            </span>
            <span className="grid min-w-0">
              <strong className="text-[12.5px] font-[620]">模型服务</strong>
              <small className="mt-1 truncate text-[11px] text-ink-muted">
                {organization?.provider.configured
                  ? `${organization.provider.endpoint} · ${organization.provider.defaultModel}`
                  : "尚未配置；替身和 Agent 工作摘要暂不可用"}
              </small>
            </span>
            {canManage ? (
              <button
                type="button"
                data-testid="pilot-provider-settings-edit"
                onClick={openProviderEditor}
                className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong"
              >
                {organization?.provider.configured
                  ? "修改配置"
                  : "配置模型服务"}
              </button>
            ) : (
              <StatusPill
                tone={organization?.provider.configured ? "green" : "faint"}
                size="sm"
              >
                {organization?.provider.configured ? "已配置" : "未配置"}
              </StatusPill>
            )}
          </div>

          {editingProvider ? (
            <div
              className="mt-4 grid gap-3 border-t border-line pt-4"
              data-testid="pilot-provider-settings-form"
            >
              <label className="grid gap-1.5">
                <span className="text-[11px] text-ink-muted">服务地址</span>
                <input
                  type="url"
                  value={providerEndpoint}
                  onChange={(event) => setProviderEndpoint(event.target.value)}
                  data-testid="pilot-provider-settings-endpoint"
                  className="h-9 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none focus:border-accent-strong"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[11px] text-ink-muted">API 密钥</span>
                <input
                  type="password"
                  value={providerKey}
                  onChange={(event) => setProviderKey(event.target.value)}
                  placeholder="修改配置时需重新输入"
                  autoComplete="new-password"
                  data-testid="pilot-provider-settings-key"
                  className="h-9 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[11px] text-ink-muted">默认模型</span>
                <input
                  value={providerModel}
                  onChange={(event) => setProviderModel(event.target.value)}
                  data-testid="pilot-provider-settings-model"
                  className="h-9 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none focus:border-accent-strong"
                />
              </label>
              <p className="text-[10.5px] leading-[1.6] text-faint">
                出于安全考虑，Intero 不会回显已有密钥；保存修改时需要重新输入。
              </p>
              {configureProvider.isError ? (
                <p className="text-[11px] text-danger" role="alert">
                  保存失败，请检查服务地址、密钥和模型名称后重试。
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="pilot-provider-settings-submit"
                  disabled={
                    !providerEndpoint.trim() ||
                    !providerKey.trim() ||
                    !providerModel.trim() ||
                    configureProvider.isPending
                  }
                  onClick={() => configureProvider.mutate()}
                  className="h-9 cursor-pointer rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:opacity-50"
                >
                  {configureProvider.isPending ? "保存中…" : "保存模型服务配置"}
                </button>
                <button
                  type="button"
                  disabled={configureProvider.isPending}
                  onClick={() => {
                    setProviderKey("");
                    setEditingProvider(false);
                  }}
                  className="h-9 cursor-pointer rounded-btn border border-line2 bg-transparent px-4 text-[12px] text-ink-muted hover:border-accent-strong"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
