import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getBestBuyStock, getTargetStock, ProductStock } from "@/lib/stock";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Retailer = "bestbuy" | "target";
const RETAILER_LABEL: Record<Retailer, string> = { bestbuy: "Best Buy", target: "Target" };

type Flip = ProductStock & { retailer: Retailer; name: string; msrp: number };

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function stockEmailHtml(flips: Flip[]): string {
  const rows = flips.map(f => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:600;color:#111827;">${f.name}</div>
        <div style="font-size:12px;color:#6b7280;">MSRP $${fmt(f.msrp)} · ${RETAILER_LABEL[f.retailer]}</div>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:center;">
        <a href="${f.url ?? (f.retailer === "target" ? "https://www.target.com" : "https://www.bestbuy.com")}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;">Buy at ${RETAILER_LABEL[f.retailer]} →</a>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:20px 24px;">
        <div style="color:#facc15;font-size:18px;font-weight:800;">🛒 CardFlip AI — Restock Alert</div>
        <div style="color:#9ca3af;font-size:13px;margin-top:4px;">
          ${flips.length} product${flips.length === 1 ? " is" : "s are"} back IN STOCK at retail. Stock vanishes fast — buy now, flip later.
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <div style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280;">
        Buy at MSRP only. If a listing shows a marked-up third-party seller, skip it.
      </div>
    </div>
  </body>
</html>`;
}

async function sendStockEmail(flips: Flip[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!apiKey || !to) return false;

  const retailers = Array.from(new Set(flips.map(f => RETAILER_LABEL[f.retailer]))).join(" + ");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CardFlip AI <onboarding@resend.dev>",
      to: [to],
      subject: `🛒 CardFlip Alert: ${flips.length === 1 ? flips[0].name : `${flips.length} sealed products`} back in stock at ${retailers}`,
      html: stockEmailHtml(flips),
    }),
  });
  return res.ok;
}

/**
 * GET /api/cron/stock — every 30 minutes (see vercel.json).
 * Checks Best Buy (official API) AND Target (unofficial RedSky; degrades to
 * "unknown" when blocked). Emails ONLY on a flip to in-stock, per retailer.
 * State transitions live in Supabase `stock_alerts_log` keyed by
 * (retailer, product_id) — repeat in-stock checks never re-alert.
 */
export async function GET() {
  try {
    const list = PRODUCTS.map(p => ({ id: p.id, name: p.name }));
    const [bestbuy, target] = await Promise.all([
      getBestBuyStock(list, true),
      getTargetStock(list, true),
    ]);

    const checks: (ProductStock & { retailer: Retailer })[] = [
      ...(bestbuy.configured ? bestbuy.statuses.map(s => ({ ...s, retailer: "bestbuy" as const })) : []),
      ...target.statuses.map(s => ({ ...s, retailer: "target" as const })),
    ];

    if (checks.length === 0) {
      return NextResponse.json({ skipped: "No retailer checks ran (BESTBUY_API_KEY not set, Target returned nothing)" });
    }
    if (!supabase) {
      return NextResponse.json({
        skipped: "Supabase not configured — stock_alerts_log needed for flip detection",
      });
    }

    // last recorded status per (retailer, product)
    const { data: logRows } = await supabase
      .from("stock_alerts_log")
      .select("product_id, retailer, status, created_at")
      .order("created_at", { ascending: false });
    const lastStatus = new Map<string, string>();
    for (const row of logRows ?? []) {
      const key = `${row.retailer ?? "bestbuy"}:${row.product_id}`;
      if (!lastStatus.has(key)) lastStatus.set(key, row.status);
    }

    const byId = new Map(PRODUCTS.map(p => [p.id, p]));
    const flips: Flip[] = [];
    const changes: { product_id: string; product_name: string; status: string; sku: string | null; retailer: Retailer }[] = [];

    for (const s of checks) {
      const prev = lastStatus.get(`${s.retailer}:${s.productId}`);
      if (prev === s.status) continue; // no change, nothing to log or alert

      const product = byId.get(s.productId)!;
      changes.push({ product_id: s.productId, product_name: product.name, status: s.status, sku: s.sku, retailer: s.retailer });

      // alert only on a flip TO in-stock from out-of-stock/unknown/never-seen
      if (s.status === "in-stock" && prev !== "in-stock") {
        flips.push({ ...s, name: product.name, msrp: product.msrp });
      }
    }

    let emailed = false;
    if (flips.length > 0) emailed = await sendStockEmail(flips);

    // record every status change (marks the new state so we don't re-alert)
    if (changes.length > 0) {
      await supabase.from("stock_alerts_log").insert(changes);
    }

    return NextResponse.json({
      bestbuyConfigured: bestbuy.configured,
      checked: checks.length,
      statusChanges: changes.length,
      flipsToInStock: flips.length,
      emailed,
      emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Stock scan failed: ${message}` }, { status: 502 });
  }
}
