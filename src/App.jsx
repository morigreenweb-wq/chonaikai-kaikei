import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

const STATUS_LABELS = {
  approval: { pending: "承認待ち", approved: "承認済み", rejected: "却下" },
  payment: { unpaid: "未払い", paid: "支払済み" },
};

const STATUS_COLORS = {
  approval: {
    pending: { bg: "#FFF3CD", text: "#856404", dot: "#F0AD00" },
    approved: { bg: "#D1FAE5", text: "#065F46", dot: "#10B981" },
    rejected: { bg: "#FEE2E2", text: "#991B1B", dot: "#EF4444" },
  },
  payment: {
    unpaid: { bg: "#EFF6FF", text: "#1E40AF", dot: "#3B82F6" },
    paid: { bg: "#F3F4F6", text: "#374151", dot: "#9CA3AF" },
  },
};

function Badge({ type, value }) {
  const c = STATUS_COLORS[type][value];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20,
      background: c.bg, color: c.text,
      fontSize: 12, fontWeight: 600,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.dot, display: "inline-block" }} />
      {STATUS_LABELS[type][value]}
    </span>
  );
}

function Modal({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 16, padding: 32, width: "100%",
        maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        {children}
      </div>
    </div>
  );
}

// DBのsnake_caseをcamelCaseに変換
function toLocal(r) {
  return {
    id: r.id,
    title: r.title,
    amount: r.amount,
    requester: r.requester,
    description: r.description || "",
    date: r.date,
    approval: r.approval,
    payment: r.payment,
    paidDate: r.paid_date || null,
  };
}

export default function App() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ title: "", amount: "", requester: "", description: "" });

  // 初回データ取得
  useEffect(() => {
    fetchRequests();
  }, []);

  async function fetchRequests() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setError("データの取得に失敗しました: " + error.message);
    } else {
      setRequests(data.map(toLocal));
    }
    setLoading(false);
  }

  const filtered = requests.filter(r => {
    if (filter === "pending_approval") return r.approval === "pending";
    if (filter === "approved_unpaid") return r.approval === "approved" && r.payment === "unpaid";
    if (filter === "paid") return r.payment === "paid";
    return true;
  });

  const totalUnpaid = requests
    .filter(r => r.approval === "approved" && r.payment === "unpaid")
    .reduce((s, r) => s + r.amount, 0);

  const totalPaid = requests
    .filter(r => r.payment === "paid")
    .reduce((s, r) => s + r.amount, 0);

  // 新規申請
  async function handleSubmit() {
    if (!form.title || !form.amount || !form.requester) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("requests")
      .insert({
        title: form.title,
        amount: parseInt(form.amount),
        requester: form.requester,
        description: form.description,
        date: new Date().toISOString().slice(0, 10),
        approval: "pending",
        payment: "unpaid",
        paid_date: null,
      })
      .select()
      .single();

    if (error) {
      alert("申請に失敗しました: " + error.message);
    } else {
      setRequests(prev => [toLocal(data), ...prev]);
      setForm({ title: "", amount: "", requester: "", description: "" });
      setShowForm(false);
    }
    setSaving(false);
  }

  // 承認ステータス更新
  async function updateApproval(id, val) {
    setSaving(true);
    const { error } = await supabase
      .from("requests")
      .update({ approval: val })
      .eq("id", id);

    if (error) {
      alert("更新に失敗しました: " + error.message);
    } else {
      setRequests(prev => prev.map(r => r.id === id ? { ...r, approval: val } : r));
      setDetail(d => d ? { ...d, approval: val } : d);
    }
    setSaving(false);
  }

  // 支払いステータス更新
  async function updatePayment(id, val) {
    setSaving(true);
    const paidDate = val === "paid" ? new Date().toISOString().slice(0, 10) : null;
    const { error } = await supabase
      .from("requests")
      .update({ payment: val, paid_date: paidDate })
      .eq("id", id);

    if (error) {
      alert("更新に失敗しました: " + error.message);
    } else {
      setRequests(prev => prev.map(r =>
        r.id === id ? { ...r, payment: val, paidDate } : r
      ));
      setDetail(d => d ? { ...d, payment: val, paidDate } : d);
    }
    setSaving(false);
  }

  const inp = (field, placeholder, type = "text") => (
    <input
      type={type} placeholder={placeholder} value={form[field]}
      onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
      style={{
        width: "100%", padding: "10px 12px", border: "1.5px solid #E5E7EB",
        borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box",
        fontFamily: "inherit",
      }}
    />
  );

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif", background: "#F8F7F4", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#1C3557", padding: "20px 24px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 800, margin: "0 auto" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, opacity: 0.6, marginBottom: 4 }}>CHONAIKAI</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>町内会　会計管理</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {saving && <span style={{ fontSize: 12, opacity: 0.7 }}>保存中…</span>}
            <button onClick={() => setShowForm(true)} style={{
              background: "#E8A020", color: "#fff", border: "none",
              padding: "10px 18px", borderRadius: 8, fontWeight: 700,
              fontSize: 13, cursor: "pointer", fontFamily: "inherit",
            }}>
              ＋ 支払い申請
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px" }}>

        {/* エラー表示 */}
        {error && (
          <div style={{
            background: "#FEE2E2", color: "#991B1B", padding: "12px 16px",
            borderRadius: 8, marginBottom: 16, fontSize: 13,
            display: "flex", justifyContent: "space-between", alignItems: "center"
          }}>
            {error}
            <button onClick={fetchRequests} style={{
              background: "#991B1B", color: "#fff", border: "none",
              padding: "4px 12px", borderRadius: 6, cursor: "pointer",
              fontSize: 12, fontFamily: "inherit",
            }}>再読み込み</button>
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
          {[
            { label: "承認待ち", value: requests.filter(r => r.approval === "pending").length + "件", color: "#F0AD00" },
            { label: "未払い（承認済）", value: "¥" + totalUnpaid.toLocaleString(), color: "#3B82F6" },
            { label: "支払済み（今月）", value: "¥" + totalPaid.toLocaleString(), color: "#10B981" },
          ].map(s => (
            <div key={s.label} style={{
              background: "#fff", borderRadius: 12, padding: "16px",
              borderTop: `3px solid ${s.color}`,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Filter Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            ["all", "すべて"],
            ["pending_approval", "承認待ち"],
            ["approved_unpaid", "支払い待ち"],
            ["paid", "支払済み"],
          ].map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)} style={{
              padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              background: filter === val ? "#1C3557" : "#fff",
              color: filter === val ? "#fff" : "#4B5563",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#9CA3AF", fontSize: 14 }}>
            読み込み中…
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF", fontSize: 14 }}>
                該当する申請がありません
              </div>
            )}
            {filtered.map(r => (
              <div key={r.id} onClick={() => setDetail(r)} style={{
                background: "#fff", borderRadius: 12, padding: "16px 20px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: "pointer",
                borderLeft: r.approval === "pending" ? "4px solid #F0AD00" :
                  r.approval === "rejected" ? "4px solid #EF4444" : "4px solid #10B981",
                transition: "box-shadow 0.15s",
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.12)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#111", marginBottom: 4 }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: "#9CA3AF" }}>{r.requester}　{r.date}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#1C3557" }}>¥{r.amount.toLocaleString()}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Badge type="approval" value={r.approval} />
                  <Badge type="payment" value={r.payment} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新規申請モーダル */}
      {showForm && (
        <Modal onClose={() => setShowForm(false)}>
          <div style={{ fontWeight: 700, fontSize: 18, color: "#1C3557", marginBottom: 20 }}>支払い申請</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {inp("title", "件名（例：清掃用品購入）")}
            {inp("requester", "申請者名")}
            {inp("amount", "金額（円）", "number")}
            <textarea
              placeholder="内容・備考（任意）"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              style={{
                width: "100%", padding: "10px 12px", border: "1.5px solid #E5E7EB",
                borderRadius: 8, fontSize: 14, resize: "vertical", boxSizing: "border-box",
                fontFamily: "inherit", outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setShowForm(false)} style={{
              flex: 1, padding: 12, border: "1.5px solid #E5E7EB", borderRadius: 8,
              background: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 14,
            }}>キャンセル</button>
            <button onClick={handleSubmit} disabled={saving} style={{
              flex: 2, padding: 12, background: saving ? "#9CA3AF" : "#1C3557", color: "#fff",
              border: "none", borderRadius: 8, fontWeight: 700,
              cursor: saving ? "default" : "pointer", fontFamily: "inherit", fontSize: 14,
            }}>{saving ? "送信中…" : "申請する"}</button>
          </div>
        </Modal>
      )}

      {/* 詳細モーダル */}
      {detail && (
        <Modal onClose={() => setDetail(null)}>
          <div style={{ fontWeight: 700, fontSize: 18, color: "#1C3557", marginBottom: 4 }}>{detail.title}</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>{detail.requester}　{detail.date}</div>
          <div style={{
            background: "#F8F7F4", borderRadius: 10, padding: 16, marginBottom: 16,
            fontSize: 28, fontWeight: 700, color: "#1C3557", textAlign: "center",
          }}>
            ¥{detail.amount.toLocaleString()}
          </div>
          {detail.description && (
            <div style={{ color: "#4B5563", fontSize: 13, marginBottom: 16 }}>{detail.description}</div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <Badge type="approval" value={detail.approval} />
            <Badge type="payment" value={detail.payment} />
            {detail.paidDate && (
              <span style={{ fontSize: 12, color: "#9CA3AF", alignSelf: "center" }}>
                支払日: {detail.paidDate}
              </span>
            )}
          </div>

          {/* 承認操作 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>🏛 会長承認</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { val: "approved", label: "✓ 承認", activeColor: "#D1FAE5", activeText: "#065F46" },
                { val: "rejected", label: "✗ 却下", activeColor: "#FEE2E2", activeText: "#991B1B" },
                { val: "pending",  label: "↩ 差戻し", activeColor: "#E5E7EB", activeText: "#374151" },
              ].map(({ val, label, activeColor, activeText }) => {
                const isActive = detail.approval === val;
                return (
                  <button key={val}
                    onClick={() => !saving && updateApproval(detail.id, val)}
                    disabled={isActive || saving}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 7, border: "none",
                      cursor: isActive || saving ? "default" : "pointer",
                      background: isActive ? activeColor : "#E5E7EB",
                      color: isActive ? activeText : "#374151",
                      fontWeight: 600, fontSize: 13, fontFamily: "inherit",
                    }}>{label}</button>
                );
              })}
            </div>
          </div>

          {/* 支払操作（承認済みのみ表示） */}
          {detail.approval === "approved" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 8 }}>💴 会計処理</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => !saving && updatePayment(detail.id, "paid")}
                  disabled={detail.payment === "paid" || saving}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 7, border: "none",
                    cursor: detail.payment === "paid" || saving ? "default" : "pointer",
                    background: detail.payment === "paid" ? "#F3F4F6" : "#1C3557",
                    color: detail.payment === "paid" ? "#9CA3AF" : "#fff",
                    fontWeight: 600, fontSize: 13, fontFamily: "inherit",
                  }}>支払い済みにする</button>
                <button
                  onClick={() => !saving && updatePayment(detail.id, "unpaid")}
                  disabled={detail.payment === "unpaid" || saving}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 7, border: "none",
                    cursor: detail.payment === "unpaid" || saving ? "default" : "pointer",
                    background: "#E5E7EB", color: "#374151",
                    fontWeight: 600, fontSize: 13, fontFamily: "inherit",
                  }}>未払いに戻す</button>
              </div>
            </div>
          )}

          <button onClick={() => setDetail(null)} style={{
            width: "100%", padding: 10, border: "1.5px solid #E5E7EB", borderRadius: 8,
            background: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 14,
          }}>閉じる</button>
        </Modal>
      )}
    </div>
  );
}
