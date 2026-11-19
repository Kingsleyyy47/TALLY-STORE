import { providerHttp } from "./provider-http.ts";
import {
  productMatchKey,
  ProviderDeclined,
  tryProductFallback,
} from "./provider-contract.ts";
import { normalizePlatform, type SmmService } from "./smm-panel-client.ts";

export type SmmProvider = "lordofpanels" | "bulkfollows";
export type SmmRoute = {
  provider: SmmProvider;
  serviceId: number;
  rate: number;
  min: number;
  max: number;
  matchKey: string;
  maxRate?: number;
};
const BULK_OFFSET = 1_000_000_000;
const panels = {
  lordofpanels: {
    url: "https://thelordofthepanels.com/api/v2",
    key: () =>
      Deno.env.get("LORDOFPANELS_API_KEY") ||
      Deno.env.get("SMM_PANEL_API_KEY") || "",
  },
  bulkfollows: {
    url: "https://bulkfollows.com/api/v2",
    key: () => Deno.env.get("BULKFOLLOWS_API_KEY") || "",
  },
};
export function configuredSmmProviders() {
  return (Object.keys(panels) as SmmProvider[]).filter((id) =>
    !!panels[id].key()
  );
}
function identity(service: SmmService) {
  return productMatchKey({
    kind: "smm",
    name: service.name,
    category: service.category,
    serviceType: service.type,
    refill: service.refill,
    cancel: service.cancel,
  });
}
async function call(
  provider: SmmProvider,
  params: Record<string, string | number>,
) {
  if (!Object.hasOwn(panels, provider) || !panels[provider].key()) {
    throw new Error("SUPPLIER_NOT_CONFIGURED");
  }
  const form = new URLSearchParams({ key: panels[provider].key() });
  for (const [key, value] of Object.entries(params)) {
    form.set(key, String(value));
  }
  return providerHttp(panels[provider].url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}
export async function syncSmmProviders(admin: any, usdNgnRate: number) {
  if (!Number.isFinite(usdNgnRate) || usdNgnRate <= 0) {
    throw new Error("EXCHANGE_RATE_REQUIRED");
  }
  const groups = new Map<
    string,
    Array<{ provider: SmmProvider; service: SmmService }>
  >();
  const diagnostics: Record<string, string> = {};
  for (const provider of configuredSmmProviders()) {
    try {
      const balance = await call(provider, { action: "balance" });
      // The panel rate field has the account's currency; never assume USD.
      if (!balance.ok || balance.data?.currency !== "USD") {
        throw new Error("USD_ACCOUNT_REQUIRED");
      }
      const response = await call(provider, { action: "services" });
      if (!response.ok || !Array.isArray(response.data)) {
        throw new Error("CATALOG_UNAVAILABLE");
      }
      for (const service of response.data as SmmService[]) {
        const key = identity(service),
          id = Number(service.service),
          rate = Number(service.rate);
        if (
          !key || !Number.isSafeInteger(id) || id <= 0 || id >= BULK_OFFSET ||
          !Number.isFinite(rate) || rate <= 0 ||
          !Number.isSafeInteger(Number(service.min)) ||
          !Number.isSafeInteger(Number(service.max)) ||
          Number(service.min) < 1 || Number(service.max) < Number(service.min)
        ) continue;
        groups.set(key, [...(groups.get(key) || []), { provider, service }]);
      }
      diagnostics[provider] = "ready";
    } catch {
      diagnostics[provider] = "unavailable_or_non_usd_account";
    }
  }
  // A failed supplier sync never disables its previously known products.
  let processed = 0;
  const routeRows: any[] = [], serviceRows: any[] = [];
  const existing = await admin.from("supplier_product_routes").select(
    "product_key,match_key",
  ).eq("family", "smm");
  if (existing.error) throw new Error("SUPPLIER_ROUTE_UNAVAILABLE");
  const previousKeys = new Map(
    (existing.data || []).map((row: any) => [row.match_key, row.product_key]),
  );
  const ambiguousKeys = new Set<string>();
  const unambiguous: Array<
    [string, Array<{ provider: SmmProvider; service: SmmService }>]
  > = [];
  for (const [matchKey, entries] of groups) {
    const ambiguous = entries.some((row) =>
      entries.filter((other) => other.provider === row.provider).length > 1
    );
    if (ambiguous) {
      ambiguousKeys.add(matchKey);
      for (const entry of entries) unambiguous.push([matchKey, [entry]]);
    } else unambiguous.push([matchKey, entries]);
  }
  for (const [matchKey, entries] of unambiguous) {
    entries.sort((a, b) =>
      (a.provider === "lordofpanels" ? -1 : 1) -
        (b.provider === "lordofpanels" ? -1 : 1) ||
      Number(a.service.rate) - Number(b.service.rate)
    );
    const primary = entries[0], service = primary.service;
    const externalId =
      !ambiguousKeys.has(matchKey) && previousKeys.has(matchKey)
        ? Number(previousKeys.get(matchKey))
        : Number(service.service) +
          (primary.provider === "bulkfollows" ? BULK_OFFSET : 0);
    const routes: SmmRoute[] = entries.map((row) => ({
      provider: row.provider,
      serviceId: Number(row.service.service),
      rate: Number(row.service.rate),
      min: Number(row.service.min),
      max: Number(row.service.max),
      matchKey,
    }));
    // Store provider routes separately: customer catalogue projections never
    // receive supplier names, supplier identifiers, costs or credentials.
    routeRows.push({
      family: "smm",
      product_key: String(externalId),
      match_key: matchKey,
      routes,
      synced_at: new Date().toISOString(),
    });
    serviceRows.push({
      external_id: externalId,
      name: service.name,
      category: service.category,
      platform: normalizePlatform(service.category),
      service_type: service.type,
      rate_usd: Number(service.rate),
      price_ngn: Math.ceil(Number(service.rate) * usdNgnRate * 2),
      min_quantity: Number(service.min),
      max_quantity: Number(service.max),
      has_refill: service.refill,
      has_cancel: service.cancel,
      supplier_routing: true,
      last_synced_at: new Date().toISOString(),
    });
    processed++;
  }
  for (let i = 0; i < routeRows.length; i += 250) {
    const saved = await admin.from("supplier_product_routes").upsert(
      routeRows.slice(i, i + 250),
      { onConflict: "family,product_key" },
    );
    if (saved.error) throw new Error("SUPPLIER_ROUTE_SAVE_FAILED");
    const result = await admin.from("smm_services").upsert(
      serviceRows.slice(i, i + 250),
      { onConflict: "external_id" },
    );
    if (result.error) throw new Error("SUPPLIER_CATALOG_SAVE_FAILED");
  }
  return { processed, diagnostics };
}
export async function planSmmRoutes(
  admin: any,
  service: any,
  quantity: number,
  maxRate: number,
): Promise<SmmRoute[]> {
  const saved = await admin.from("supplier_product_routes").select(
    "match_key,routes,synced_at",
  ).eq("family", "smm").eq("product_key", String(service.external_id)).single();
  const expected = productMatchKey({
    kind: "smm",
    name: service.name,
    category: service.category,
    serviceType: service.service_type,
    refill: service.has_refill,
    cancel: service.has_cancel,
  });
  if (
    saved.error || !expected || saved.data?.match_key !== expected ||
    !Array.isArray(saved.data.routes)
  ) throw new Error("SUPPLIER_ROUTE_UNAVAILABLE");
  const routes = (saved.data.routes as SmmRoute[]).filter((row) =>
    row.matchKey === expected &&
    configuredSmmProviders().includes(row.provider) &&
    row.rate > 0 && row.rate <= maxRate && quantity >= row.min &&
    quantity <= row.max
  );
  if (!routes.length) throw new Error("SUPPLIER_ROUTE_UNAVAILABLE");
  return routes.sort((a, b) => a.rate - b.rate).map((row) => ({
    ...row,
    maxRate,
  }));
}
export async function dispatchSmmRoutes(
  admin: any,
  orderId: string,
  routes: SmmRoute[],
  params: Record<string, string | number>,
  journal?: (data: Record<string, unknown>) => Promise<void>,
) {
  const attempts: Array<Record<string, unknown>> = [];
  const persist = async (data: Record<string, unknown>) => {
    if (journal) return journal(data);
    const saved = await admin.from("smm_orders").update({
      panel_response: data,
    }).eq("id", orderId);
    if (saved.error) throw new Error("SUPPLIER_ROUTE_SAVE_FAILED");
  };
  return tryProductFallback(routes, async (route) => {
    // Panel APIs offer no price-ceiling field. Recheck the actual service and
    // its full identity immediately before spending against the approved cap.
    let current: SmmService | undefined;
    try {
      const catalog = await call(route.provider, { action: "services" });
      if (catalog.ok && Array.isArray(catalog.data)) {
        current = catalog.data.find((row: SmmService) =>
          Number(row.service) === route.serviceId
        );
      }
    } catch {
      /* No purchase was attempted; other matching suppliers are safe. */
    }
    if (
      !current || identity(current) !== route.matchKey ||
      Number(current.rate) > (route.maxRate ?? route.rate) ||
      !Number.isFinite(Number(current.rate)) || Number(current.rate) <= 0
    ) {
      throw new ProviderDeclined("NO_NUMBERS");
    }
    const quantity = Number(params.quantity);
    if (
      params.quantity !== undefined &&
      (!Number.isInteger(quantity) || quantity < Number(current.min) ||
        quantity > Number(current.max))
    ) throw new ProviderDeclined("NO_NUMBERS");
    // Persist the exact route BEFORE every paid request. A lost acknowledgement
    // stops here; neither a retry nor another provider is allowed.
    const routing = { provider: route.provider, serviceId: route.serviceId };
    await persist({ routing, attempts, outcome: "sending" });
    const response = await call(route.provider, {
      ...params,
      action: "add",
      service: route.serviceId,
    });
    if (
      !response.ok || !response.data || typeof response.data !== "object" ||
      Array.isArray(response.data)
    ) throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
    const data = response.data;
    if (data.order != null) {
      const order = Number(data.order);
      if (!Number.isSafeInteger(order) || order <= 0) {
        throw new Error(
          "SUPPLIER_OUTCOME_UNKNOWN",
        );
      }
      if (journal) {
        await persist({
          routing,
          attempts,
          order,
          outcome: "accepted",
        });
      }
      return { ...data, order, routing, attempts, supplier_rate_usd: Number(current.rate) };
    }
    // Exact known no-order responses only; a generic error is ambiguous.
    const error = String(data.error || "").trim().toLowerCase();
    if (
      [
        "service is not available",
        "service is unavailable",
        "service is currently unavailable",
        "not enough balance",
        "insufficient balance",
      ].includes(error)
    ) {
      attempts.push({
        ...routing,
        outcome: "declined",
        reason: error.includes("balance") ? "NO_MONEY" : "NO_NUMBERS",
      });
      await persist({ routing, attempts, outcome: "declined" });
      throw new ProviderDeclined(
        error.includes("balance") ? "NO_MONEY" : "NO_NUMBERS",
      );
    }
    throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
  });
}
export async function routedSmmStatus(order: any) {
  const provider = order.panel_response?.routing?.provider;
  if (
    !configuredSmmProviders().includes(provider) ||
    !Number.isSafeInteger(Number(order.external_order_id))
  ) throw new Error("SUPPLIER_ROUTE_UNAVAILABLE");
  const response = await call(provider, {
    action: "status",
    order: order.external_order_id,
  });
  if (
    !response.ok || !response.data || response.data.error ||
    typeof response.data.status !== "string"
  ) throw new Error("SUPPLIER_STATUS_UNAVAILABLE");
  return { ...response.data, routing: order.panel_response.routing };
}

export async function smmProviderReadiness() {
  return Promise.all(configuredSmmProviders().map(async provider=>{
    try {const response=await call(provider,{action:'balance'});return {provider,authenticated:response.ok&&!response.data?.error&&typeof response.data?.currency==='string',currency:response.data?.currency||null}}
    catch{return {provider,authenticated:false,currency:null}}
  }))
}

// Panel API supports up to 100 order IDs per call. Keep supplier identities
// separate so overlapping numeric IDs cannot mix orders from different panels.
export async function routedSmmStatuses(orders:any[]) {
  const groups=new Map<SmmProvider,any[]>()
  const output:Record<string,any>={}
  for(const order of orders){const provider=order.panel_response?.routing?.provider;if(configuredSmmProviders().includes(provider))groups.set(provider,[...(groups.get(provider)||[]),order])}
  await Promise.all([...groups].map(async([provider,list])=>{
    for(let i=0;i<list.length;i+=100){const batch=list.slice(i,i+100)
      try{const response=await call(provider,batch.length===1?{action:'status',order:batch[0].external_order_id}:{action:'status',orders:batch.map(order=>order.external_order_id).join(',')})
        if(!response.ok||!response.data)continue
        for(const order of batch){const row=batch.length===1?response.data:response.data[String(order.external_order_id)];if(row&&!row.error&&typeof row.status==='string')output[order.id]={...row,routing:order.panel_response.routing}}
      }catch{/* Read-only poll may retry on the next normal poll interval. */}
    }
  }))
  return output
}
