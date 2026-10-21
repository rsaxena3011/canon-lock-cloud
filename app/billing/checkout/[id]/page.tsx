"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatPriceCents } from "@/lib/billing/plans";
import type { Tier } from "@/lib/store/types";

interface SessionView {
  id: string;
  tier: Tier;
  priceCents: number;
  status: "open" | "complete" | "cancelled";
  completedAt: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data;
}

function futureExpiry(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String((now.getFullYear() + 3) % 100).padStart(2, "0");
  return `${month}/${year}`;
}

export default function CheckoutPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ session: SessionView }>(
        `/api/billing/sessions/${id}`
      );
      setSession(data.session);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This checkout session could not be loaded"
      );
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function useTestCard() {
    setCardName("Test Judge");
    setCardNumber("4242 4242 4242 4242");
    setCardExpiry(futureExpiry());
    setCardCvc("123");
    setError(null);
  }

  async function pay() {
    if (cardNumber.replace(/\s/g, "").length < 12) {
      setError("Enter a card number, or use the test card button.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/billing/sessions/${id}/complete`, { method: "POST" });
      window.location.href = "/check?billing=success";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/billing/sessions/${id}/cancel`, { method: "POST" });
      window.location.href = "/check?billing=cancelled";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ paddingTop: "2rem", maxWidth: "640px" }}>
      <h1 style={{ fontSize: "2rem" }}>Checkout</h1>

      <div
        className="privacy-note"
        style={{
          margin: "1rem 0",
          borderColor: "#b45309",
          background: "#fffbeb",
          fontWeight: 600,
        }}
      >
        TEST MODE: this checkout is a simulation. No real payment is
        taken, no card is charged, and no card data is stored anywhere.
      </div>

      {error && <div className="error-box">{error}</div>}

      {!session && !error && <p>Loading your checkout session...</p>}

      {session && session.status === "complete" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Already complete</h2>
          <p>
            This checkout already upgraded the account to the{" "}
            <strong>{session.tier}</strong> plan. Paying again changes
            nothing.
          </p>
          <Link href="/check">Back to the checker</Link>
        </div>
      )}

      {session && session.status === "cancelled" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Checkout cancelled</h2>
          <p>
            This checkout was cancelled before payment. The plan did not
            change.
          </p>
          <Link href="/check">Back to the checker</Link>
        </div>
      )}

      {session && session.status === "open" && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Order summary</h2>
          <table className="rows">
            <tbody>
              <tr>
                <td>Canon Lock Cloud, {session.tier} plan</td>
                <td>{formatPriceCents(session.priceCents)} / month</td>
              </tr>
              <tr>
                <td>Due today (test mode)</td>
                <td>{formatPriceCents(session.priceCents)}</td>
              </tr>
            </tbody>
          </table>

          <h3>Payment details</h3>
          <label className="field" htmlFor="card-name">
            Name on card
          </label>
          <input
            id="card-name"
            type="text"
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            placeholder="Any name"
          />
          <label className="field" htmlFor="card-number">
            Card number
          </label>
          <input
            id="card-number"
            type="text"
            inputMode="numeric"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            placeholder="4242 4242 4242 4242"
          />
          <div className="row-actions">
            <div>
              <label className="field" htmlFor="card-expiry">
                Expiry (MM/YY)
              </label>
              <input
                id="card-expiry"
                type="text"
                value={cardExpiry}
                onChange={(e) => setCardExpiry(e.target.value)}
                placeholder="MM/YY"
              />
            </div>
            <div>
              <label className="field" htmlFor="card-cvc">
                CVC
              </label>
              <input
                id="card-cvc"
                type="text"
                inputMode="numeric"
                value={cardCvc}
                onChange={(e) => setCardCvc(e.target.value)}
                placeholder="123"
              />
            </div>
          </div>
          <div className="row-actions" style={{ marginTop: "0.75rem" }}>
            <button
              className="action secondary"
              onClick={useTestCard}
              disabled={busy}
            >
              Use test card
            </button>
            <button className="action" onClick={pay} disabled={busy}>
              Pay {formatPriceCents(session.priceCents)} (test mode)
            </button>
          </div>
          <p
            style={{
              color: "var(--ink-soft)",
              fontSize: "0.94rem",
              marginTop: "1rem",
            }}
          >
            The test card always succeeds. Card fields are a formality
            of the simulation: their values are never sent anywhere or
            stored.{" "}
            <button
              className="mini"
              onClick={cancel}
              disabled={busy}
              style={{ marginLeft: "0.25rem" }}
            >
              Cancel checkout
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
