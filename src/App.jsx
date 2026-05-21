import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

const DEFAULT_ADMIN_PASSWORD = "2709";
const HIGH_AMOUNT_THRESHOLD = 50000;
const FISCAL_YEARS = [2026, 2027, 2028];
const ACCOUNTS = ["銀行口座", "小口口座", "現金"];
const ACCOUNT_COLORS = { "銀行口座":"#3B82F6", "小口口座":"#8B5CF6", "現金":"#10B981" };
const ACCOUNT_ICONS  = { "銀行口座":"🏦", "小口口座":"💼", "現金":"💴" };

const INCOME_CATEGORIES = ["[01] 繰越","[02] 町会費","[03] 防犯灯電気代補助","[04] 行政事務委託料","[05] 利息・その他"];
const EXPENSE_CATEGORIES = ["[01] 防犯灯電気代＋防犯灯設置代","[02] 公民館行事","[03] スポーツ大会参加","[04] 各種委託料","[05] 自治会賠償責任保険","[06] 公行事出動費","[07] 各種団体募金等","[08] 行政事務手当て","[09] 組長手当て","[10] 防災・防犯機器購入","[11] 事務費・雑費","[12] その他"];

const STATUS_LABELS = {
  approval: { pending:"承認待ち", approved:"承認済み", rejected:"却下" },
  payment:  { unpaid:"未払い", paid:"支払済み" },
};
const STATUS_COLORS = {
  approval: { pending:{bg:"#FFF3CD",text:"#856404",dot:"#F0AD00"}, approved:{bg:"#D1FAE5",text:"#065F46",dot:"#10B981"}, rejected:{bg:"#FEE2E2",text:"#991B1B",dot:"#EF4444"} },
  payment:  { unpaid:{bg:"#EFF6FF",text:"#1E40AF",dot:"#3B82F6"}, paid:{bg:"#F3F4F6",text:"#374151",dot:"#9CA3AF"} },
};

const today = () => new Date().toISOString().slice(0,10);

// DB変換
function toLocalExp(r) {
  return {
    id:r.id, category:r.category||"", title:r.title, amount:r.amount,
    requester:r.requester, description:r.description||"",
    appliedDate:r.applied_date||null, approvedDate:r.approved_date||null, paidDate:r.paid_date||null,
    approval:r.approval, payment:r.payment, account:r.account||null,
    rejectReason:r.reject_reason||"", adminNote:r.admin_note||"",
    approvedBy:r.approved_by||"", approveComment:r.approve_comment||"",
    fiscalYear:r.fiscal_year||2026, deleted:r.deleted||false,
  };
}
function toLocalInc(r) {
  return {
    id:r.id, category:r.category||"", amount:r.amount,
    date:r.date, note:r.note||"", account:r.account||null,
    fiscalYear:r.fiscal_year||2026, deleted:r.deleted||false,
  };
}
function toLocalTrans(r) {
  return {
    id:r.id, from:r.from_account, to:r.to_account,
    amount:r.amount, fee:r.fee||0, date:r.date,
    fiscalYear:r.fiscal_year||2026,
  };
}

// ── 権限ヘルパー ─────────────────────────────────────
function canEdit(expense, isAdmin) {
  if (expense.approval==="pending") return true;
  return isAdmin;
}
function canDelete(expense, isAdmin) {
  if (expense.approval==="pending") return true;
  return isAdmin;
}
function canApproveReject(expense, isAdmin) {
  if (expense.payment==="paid") return false;
  if (expense.approval==="pending") return true;
  return isAdmin;
}
function canRevert(expense, isAdmin) {
  if (expense.approval==="pending") return false;
  return isAdmin;
}

// ── 小コンポーネント ─────────────────────────────────
function Badge({ type, value }) {
  const c = STATUS_COLORS[type][value];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20, background:c.bg, color:c.text, fontSize:12, fontWeight:600 }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:c.dot, display:"inline-block" }} />
      {STATUS_LABELS[type][value]}
    </span>
  );
}
function AccountBadge({ account }) {
  if (!account) return null;
  const color = ACCOUNT_COLORS[account]||"#6B7280";
  const icon  = ACCOUNT_ICONS[account]||"💳";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:20, background:`${color}18`, color, fontSize:12, fontWeight:600, border:`1px solid ${color}40` }}>
      {icon} {account}
    </span>
  );
}
function DateRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"4px 0", borderBottom:"1px solid #F3F4F6" }}>
      <span style={{ color:"#6B7280" }}>{label}</span>
      <span style={{ color:"#374151", fontWeight:500 }}>{value}</span>
    </div>
  );
}
function Modal({ onClose, children }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:490, boxShadow:"0 20px 60px rgba(0,0,0,0.25)", maxHeight:"90vh", overflowY:"auto" }}>
        {children}
      </div>
    </div>
  );
}
function Label({ children }) {
  return <div style={{ fontSize:12, fontWeight:700, color:"#6B7280", marginBottom:6 }}>{children}</div>;
}
function InputField({ value, onChange, placeholder, type="text", error, readOnly }) {
  return (
    <div>
      <input type={type} placeholder={placeholder} value={value||""} onChange={onChange} readOnly={readOnly}
        style={{ width:"100%", padding:"10px 12px", border:`1.5px solid ${error?"#EF4444":"#E5E7EB"}`, borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:readOnly?"#F9FAFB":error?"#FFF5F5":"#fff" }} />
      {error && <div style={{ color:"#EF4444", fontSize:12, marginTop:4 }}>⚠ {error}</div>}
    </div>
  );
}
function SelectField({ value, onChange, options, includeBlank }) {
  return (
    <select value={value||""} onChange={onChange}
      style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #E5E7EB", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:"#fff" }}>
      {includeBlank && <option value="">未設定</option>}
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ── 管理者認証モーダル ──────────────────────────────
function AdminAuthModal({ onSuccess, onClose, adminPassword }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  function check() {
    if (pw===adminPassword) onSuccess();
    else { setError(true); setPw(""); }
  }
  return (
    <Modal onClose={onClose}>
      <div style={{ textAlign:"center", marginBottom:20 }}>
        <div style={{ fontSize:32, marginBottom:8 }}>🔐</div>
        <div style={{ fontSize:18, fontWeight:700, color:"#1C3557" }}>管理者認証</div>
        <div style={{ fontSize:13, color:"#6B7280", marginTop:4 }}>この操作には管理者パスワードが必要です</div>
      </div>
      <InputField type="password" placeholder="パスワードを入力" value={pw} onChange={e=>{ setPw(e.target.value); setError(false); }} />
      {error && <div style={{ color:"#EF4444", fontSize:13, marginTop:8, textAlign:"center" }}>パスワードが違います</div>}
      <div style={{ display:"flex", gap:10, marginTop:16 }}>
        <button onClick={onClose} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
        <button onClick={check} style={{ flex:2, padding:12, background:"#1C3557", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>認証する</button>
      </div>
    </Modal>
  );
}

// ── パスワード変更モーダル ──────────────────────────
function ChangePasswordModal({ adminPassword, onSave, onClose }) {
  const [current, setCurrent] = useState("");
  const [newPw,   setNewPw]   = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors,  setErrors]  = useState({});
  const [success, setSuccess] = useState(false);
  function handleSave() {
    const e={};
    if (current!==adminPassword) e.current="現在のパスワードが違います";
    if (newPw.length<4)          e.newPw="4文字以上で入力してください";
    if (newPw!==confirm)         e.confirm="新パスワードが一致しません";
    setErrors(e);
    if (Object.keys(e).length>0) return;
    onSave(newPw);
    setSuccess(true);
  }
  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight:700, fontSize:17, color:"#1C3557", marginBottom:20 }}>🔑 管理者パスワード変更</div>
      {success ? (
        <div style={{ textAlign:"center", padding:"20px 0" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
          <div style={{ fontWeight:700, fontSize:15, color:"#065F46", marginBottom:6 }}>パスワードを変更しました</div>
          <div style={{ fontSize:13, color:"#6B7280", marginBottom:20 }}>次回から新しいパスワードでログインしてください</div>
          <button onClick={onClose} style={{ padding:"10px 32px", background:"#1C3557", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>閉じる</button>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div><Label>現在のパスワード</Label><InputField type="password" value={current} onChange={e=>{ setCurrent(e.target.value); setErrors(v=>({...v,current:null})); }} placeholder="現在のパスワード" error={errors.current} /></div>
          <div><Label>新しいパスワード（4文字以上）</Label><InputField type="password" value={newPw} onChange={e=>{ setNewPw(e.target.value); setErrors(v=>({...v,newPw:null})); }} placeholder="新しいパスワード" error={errors.newPw} /></div>
          <div><Label>新しいパスワード（確認）</Label><InputField type="password" value={confirm} onChange={e=>{ setConfirm(e.target.value); setErrors(v=>({...v,confirm:null})); }} placeholder="もう一度入力" error={errors.confirm} /></div>
          <div style={{ display:"flex", gap:10, marginTop:8 }}>
            <button onClick={onClose} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
            <button onClick={handleSave} style={{ flex:2, padding:12, background:"#1C3557", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>変更する</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── 支払口座選択モーダル ────────────────────────────
function PayAccountModal({ expense, accountBalance, onConfirm, onClose }) {
  const [selectedAccount, setSelectedAccount] = useState(ACCOUNTS[0]);
  const bal = accountBalance[selectedAccount]||0;
  const insufficient = bal < expense.amount;
  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight:700, fontSize:17, color:"#1C3557", marginBottom:4 }}>💳 支払い口座を選択</div>
      <div style={{ fontSize:13, color:"#6B7280", marginBottom:16 }}>「{expense.title}」¥{expense.amount.toLocaleString()} の支払い口座</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
        {ACCOUNTS.map(acct=>{
          const b=accountBalance[acct]||0, ok=b>=expense.amount, selected=selectedAccount===acct;
          return (
            <div key={acct} onClick={()=>setSelectedAccount(acct)}
              style={{ padding:"12px 16px", borderRadius:10, border:`2px solid ${selected?ACCOUNT_COLORS[acct]:"#E5E7EB"}`, background:selected?`${ACCOUNT_COLORS[acct]}0D`:"#fff", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:20 }}>{ACCOUNT_ICONS[acct]}</span>
                <div>
                  <div style={{ fontWeight:600, fontSize:14 }}>{acct}</div>
                  <div style={{ fontSize:12, color:ok?"#6B7280":"#EF4444" }}>残高 ¥{b.toLocaleString()}{!ok&&" ⚠ 残高不足"}</div>
                </div>
              </div>
              {selected && <span style={{ color:ACCOUNT_COLORS[acct], fontWeight:700, fontSize:18 }}>✓</span>}
            </div>
          );
        })}
      </div>
      {insufficient && <div style={{ background:"#FEE2E2", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#991B1B", marginBottom:12 }}>⚠ 残高不足です。口座を変えるか、送金してから支払ってください。</div>}
      <div style={{ display:"flex", gap:10 }}>
        <button onClick={onClose} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
        <button onClick={()=>onConfirm(selectedAccount)} disabled={insufficient}
          style={{ flex:2, padding:12, background:insufficient?"#9CA3AF":"#1C3557", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:insufficient?"default":"pointer", fontFamily:"inherit", fontSize:14 }}>
          この口座で支払い済みにする
        </button>
      </div>
    </Modal>
  );
}

// ── 口座間送金モーダル ──────────────────────────────
function TransferModal({ accountBalance, onConfirm, onClose }) {
  const [from, setFrom]     = useState(ACCOUNTS[0]);
  const [to, setTo]         = useState(ACCOUNTS[1]);
  const [amount, setAmount] = useState("");
  const [fee, setFee]       = useState("");
  const fromBal    = accountBalance[from]||0;
  const totalOut   = (parseInt(amount)||0)+(parseInt(fee)||0);
  const insufficient = totalOut>fromBal;
  const invalid      = !amount||parseInt(amount)<=0||from===to;
  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight:700, fontSize:17, color:"#1C3557", marginBottom:16 }}>🔄 口座間送金</div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div><Label>送金元</Label><SelectField value={from} onChange={e=>setFrom(e.target.value)} options={ACCOUNTS} /><div style={{ fontSize:12, color:"#6B7280", marginTop:4 }}>現在残高: ¥{fromBal.toLocaleString()}</div></div>
        <div><Label>送金先</Label><SelectField value={to} onChange={e=>setTo(e.target.value)} options={ACCOUNTS} /></div>
        {from===to && <div style={{ fontSize:12, color:"#EF4444" }}>⚠ 送金元と送金先が同じです</div>}
        <div><Label>送金額（円）</Label><InputField type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0" /></div>
        <div>
          <Label>振込手数料（円）※ある場合のみ</Label>
          <InputField type="number" value={fee} onChange={e=>setFee(e.target.value)} placeholder="0（手数料なしの場合は空欄）" />
        </div>
        {fee&&parseInt(fee)>0&&(
          <div style={{ background:"#FFF3CD", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#856404" }}>
            送金元から引かれる合計：¥{totalOut.toLocaleString()}（送金額 ¥{parseInt(amount)||0} ＋ 手数料 ¥{parseInt(fee)||0}）
          </div>
        )}
        {insufficient&&<div style={{ fontSize:12, color:"#EF4444" }}>⚠ 残高不足です（必要額: ¥{totalOut.toLocaleString()}）</div>}
      </div>
      <div style={{ display:"flex", gap:10, marginTop:20 }}>
        <button onClick={onClose} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
        <button onClick={()=>onConfirm(from,to,parseInt(amount),parseInt(fee)||0)} disabled={invalid||insufficient}
          style={{ flex:2, padding:12, background:invalid||insufficient?"#9CA3AF":"#10B981", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:invalid||insufficient?"default":"pointer", fontFamily:"inherit", fontSize:14 }}>送金する</button>
      </div>
    </Modal>
  );
}

// ── 支出編集モーダル ────────────────────────────────
function ExpenseEditModal({ item, isAdmin, onSave, onClose }) {
  const [form, setForm] = useState({
    category:item.category, title:item.title, amount:String(item.amount),
    requester:item.requester, description:item.description,
    approval:item.approval, payment:item.payment,
    appliedDate:item.appliedDate||"", approvedDate:item.approvedDate||"", paidDate:item.paidDate||"",
    account:item.account||"", rejectReason:item.rejectReason||"", adminNote:item.adminNote||"",
  });
  const f = field => e => setForm(p=>({...p,[field]:e.target.value}));
  return (
    <Modal onClose={onClose}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}>
        {isAdmin&&<span style={{ background:"#E8A020", color:"#fff", fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:12 }}>🔓 管理者編集</span>}
        <div style={{ fontWeight:700, fontSize:17, color:"#1C3557" }}>支出内容を編集</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div><Label>支出カテゴリ</Label><SelectField value={form.category} onChange={f("category")} options={EXPENSE_CATEGORIES} /></div>
        <div><Label>件名</Label><InputField value={form.title} onChange={f("title")} placeholder="件名" /></div>
        <div><Label>申請者名</Label><InputField value={form.requester} onChange={f("requester")} placeholder="氏名" /></div>
        <div>
          <Label>金額（円）</Label>
          <InputField type="number" value={form.amount} onChange={f("amount")} placeholder="0" />
          {parseInt(form.amount)>=HIGH_AMOUNT_THRESHOLD&&<div style={{ marginTop:6, background:"#FFF3CD", borderRadius:6, padding:"6px 10px", fontSize:12, color:"#856404" }}>⚠ 高額（¥{parseInt(form.amount).toLocaleString()}）</div>}
        </div>
        <div><Label>内容・備考</Label>
          <textarea value={form.description} onChange={f("description")} rows={2}
            style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #E5E7EB", borderRadius:8, fontSize:14, resize:"vertical", boxSizing:"border-box", fontFamily:"inherit", outline:"none" }} />
        </div>
        {isAdmin&&(
          <>
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1 }}><Label>承認ステータス</Label><SelectField value={form.approval} onChange={f("approval")} options={["pending","approved","rejected"]} /></div>
              <div style={{ flex:1 }}><Label>支払ステータス</Label><SelectField value={form.payment} onChange={f("payment")} options={["unpaid","paid"]} /></div>
            </div>
            <div style={{ background:"#F8F7F4", borderRadius:8, padding:12 }}>
              <Label>日付の修正（手動）</Label>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[["申請日","appliedDate"],["承認日","approvedDate"],["支払日","paidDate"]].map(([label,key])=>(
                  <div key={key} style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontSize:12, color:"#6B7280", width:60 }}>{label}</span>
                    <InputField type="date" value={form[key]} onChange={f(key)} />
                  </div>
                ))}
              </div>
            </div>
            <div><Label>💳 支払口座</Label><SelectField value={form.account} onChange={f("account")} options={ACCOUNTS} includeBlank /></div>
            {form.approval==="rejected"&&<div><Label>却下理由</Label><InputField value={form.rejectReason} onChange={f("rejectReason")} placeholder="却下理由" /></div>}
            <div><Label>🗒 管理者メモ</Label>
              <textarea value={form.adminNote} onChange={f("adminNote")} rows={2} placeholder="例：〇〇さんに確認済み"
                style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #FDE68A", borderRadius:8, fontSize:14, resize:"vertical", boxSizing:"border-box", fontFamily:"inherit", outline:"none", background:"#FFFBEB" }} />
            </div>
          </>
        )}
      </div>
      <div style={{ display:"flex", gap:10, marginTop:20 }}>
        <button onClick={onClose} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
        <button onClick={()=>onSave({...form, amount:parseInt(form.amount), paidDate:form.paidDate||null, approvedDate:form.approvedDate||null, account:form.account||null})}
          style={{ flex:2, padding:12, background:"#E8A020", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>保存する</button>
      </div>
    </Modal>
  );
}

// ── 収入編集モーダル ────────────────────────────────
function IncomeEditModal({ item, onSave, onClose }) {
  const [form, setForm] = useState({ category:item.category, amount:String(item.amount), date:item.date, note:item.note||"", account:item.account||ACCOUNTS[0] });
  const f = field => e => setForm(p=>({...p,[field]:e.target.value}));
  return (
    <Modal onClose={onClose}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}>
        <span style={{ background:"#E8A020", color:"#fff", fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:12 }}>🔓 管理者編集</span>
        <div style={{ fontWeight:700, fontSize:17, color:"#1C3557" }}>収入内容を編集</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div><Label>収入カテゴリ</Label><SelectField value={form.category} onChange={f("category")} options={INCOME_CATEGORIES} /></div>
        <div><Label>金額（円）</Label><InputField type="number" value={form.amount} onChange={f("amount")} placeholder="0" /></div>
        <div><Label>日付</Label><InputField type="date" value={form.date} onChange={f("date")} /></div>
        <div><Label>💳 入金口座</Label><SelectField value={form.account} onChange={f("account")} options={ACCOUNTS} /></div>
        <div><Label>備考</Label><InputField value={form.note} onChange={f("note")} placeholder="例：令和7年度繰越" /></div>
      </div>
      <div style={{ display:"flex", gap:10, marginTop:20 }}>
        <button onClick={onClose} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
        <button onClick={()=>onSave({...form, amount:parseInt(form.amount)})}
          style={{ flex:2, padding:12, background:"#E8A020", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>保存する</button>
      </div>
    </Modal>
  );
}

// ── 予算設定モーダル ────────────────────────────────
function BudgetEditModal({ budgets, onSave, onClose, saving }) {
  const [form, setForm] = useState(() => {
    const init = {};
    [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES].forEach(cat => {
      init[cat] = budgets[cat] ? String(budgets[cat]) : "";
    });
    return init;
  });
  const incTotal = INCOME_CATEGORIES.reduce((s,c)=>s+(parseInt(form[c])||0),0);
  const expTotal = EXPENSE_CATEGORIES.reduce((s,c)=>s+(parseInt(form[c])||0),0);

  return (
    <Modal onClose={onClose}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
        <span style={{ background:"#E8A020", color:"#fff", fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:12 }}>🔓 管理者</span>
        <div style={{ fontWeight:700, fontSize:17, color:"#1C3557" }}>📋 予算設定</div>
      </div>
      <div style={{ fontSize:12, color:"#6B7280", marginBottom:12 }}>各カテゴリの予算額を入力（0または空欄は未設定）</div>
      <div style={{ maxHeight:"60vh", overflowY:"auto", paddingRight:4 }}>

        {/* 収入 */}
        <div style={{ fontSize:12, fontWeight:700, color:"#10B981", marginBottom:8, marginTop:4 }}>💰 収入カテゴリ</div>
        {INCOME_CATEGORIES.map(cat=>(
          <div key={cat} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <div style={{ flex:1, fontSize:13, color:"#374151" }}>{cat}</div>
            <input type="number" placeholder="0" value={form[cat]}
              onChange={e=>setForm(p=>({...p,[cat]:e.target.value}))}
              style={{ width:130, padding:"7px 10px", border:"1.5px solid #E5E7EB", borderRadius:7, fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit", textAlign:"right" }} />
          </div>
        ))}
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#10B981", fontWeight:700, padding:"6px 0", borderTop:"1px solid #E5E7EB", marginBottom:16 }}>
          <span>収入予算合計</span><span>¥{incTotal.toLocaleString()}</span>
        </div>

        {/* 支出 */}
        <div style={{ fontSize:12, fontWeight:700, color:"#3B82F6", marginBottom:8 }}>💸 支出カテゴリ</div>
        {EXPENSE_CATEGORIES.map(cat=>(
          <div key={cat} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <div style={{ flex:1, fontSize:13, color:"#374151" }}>{cat}</div>
            <input type="number" placeholder="0" value={form[cat]}
              onChange={e=>setForm(p=>({...p,[cat]:e.target.value}))}
              style={{ width:130, padding:"7px 10px", border:"1.5px solid #E5E7EB", borderRadius:7, fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit", textAlign:"right" }} />
          </div>
        ))}
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#3B82F6", fontWeight:700, padding:"6px 0", borderTop:"1px solid #E5E7EB" }}>
          <span>支出予算合計</span><span>¥{expTotal.toLocaleString()}</span>
        </div>
      </div>

      <div style={{ display:"flex", gap:10, marginTop:16 }}>
        <button onClick={onClose} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
        <button onClick={()=>onSave(form)} disabled={saving}
          style={{ flex:2, padding:12, background:saving?"#9CA3AF":"#1C3557", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:saving?"default":"pointer", fontFamily:"inherit", fontSize:14 }}>
          {saving?"保存中…":"保存する"}
        </button>
      </div>
    </Modal>
  );
}

// ── メイン ───────────────────────────────────────────
export default function App() {
  const [adminPassword, setAdminPassword] = useState(DEFAULT_ADMIN_PASSWORD);
  const [isAdmin, setIsAdmin]             = useState(false);
  const [showAdminAuth, setShowAdminAuth] = useState(false);
  const [adminAction, setAdminAction]     = useState(null);
  const [showChangePw, setShowChangePw]   = useState(false);
  const [saving, setSaving]               = useState(false);
  const [loading, setLoading]             = useState(true);
  const [fetchError, setFetchError]       = useState(null);

  const [fiscalYear, setFiscalYear] = useState(2026);
  const [tab, setTab]               = useState("summary");
  const [trashTab, setTrashTab]     = useState("expense");
  const [expFilter, setExpFilter]   = useState("all");

  const [expenses,  setExpenses]  = useState([]);
  const [incomes,   setIncomes]   = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [budgets,   setBudgets]   = useState({}); // { "[02] 公民館行事": 120000, ... }
  const [showBudgetEdit, setShowBudgetEdit] = useState(false);

  const emptyExp = { category:EXPENSE_CATEGORIES[0], title:"", amount:"", requester:"", description:"" };
  const emptyInc = { category:INCOME_CATEGORIES[0], amount:"", date:today(), note:"", account:ACCOUNTS[0] };

  const [showExpForm,      setShowExpForm]      = useState(false);
  const [expForm,          setExpForm]          = useState(emptyExp);
  const [expErrors,        setExpErrors]        = useState({});
  const [showIncForm,      setShowIncForm]      = useState(false);
  const [incForm,          setIncForm]          = useState(emptyInc);
  const [showTransfer,     setShowTransfer]     = useState(false);
  const [payTarget,        setPayTarget]        = useState(null);
  const [detail,           setDetail]           = useState(null);
  const [confirmDelete,    setConfirmDelete]    = useState(false);
  const [rejectReason,     setRejectReason]     = useState("");
  const [showRejectInput,  setShowRejectInput]  = useState(false);
  const [showApproveInput, setShowApproveInput] = useState(false);
  const [approvedBy,       setApprovedBy]       = useState("");
  const [approveComment,   setApproveComment]   = useState("");
  const [approveError,     setApproveError]     = useState("");
  const [showUnpaidConfirm,setShowUnpaidConfirm]= useState(false);
  const [confirmIncDelete, setConfirmIncDelete] = useState(null);
  const [editExpItem,      setEditExpItem]      = useState(null);
  const [editIncItem,      setEditIncItem]      = useState(null);

  // ── データ取得 ──
  useEffect(() => { fetchAll(); }, [fiscalYear]);

  async function fetchAll() {
    setLoading(true); setFetchError(null);
    const [expRes, incRes, transRes, pwRes, budgetRes] = await Promise.all([
      supabase.from("requests").select("*").eq("fiscal_year", fiscalYear).order("created_at", { ascending:false }),
      supabase.from("incomes").select("*").eq("fiscal_year", fiscalYear).order("date", { ascending:false }),
      supabase.from("transfers").select("*").eq("fiscal_year", fiscalYear).order("date", { ascending:false }),
      supabase.from("settings").select("value").eq("key", "admin_password").single(),
      supabase.from("budgets").select("*").eq("fiscal_year", fiscalYear),
    ]);
    if (expRes.error)    setFetchError("支出データ取得失敗: " + expRes.error.message);
    else setExpenses(expRes.data.map(toLocalExp));
    if (incRes.error)    setFetchError("収入データ取得失敗: " + incRes.error.message);
    else setIncomes(incRes.data.map(toLocalInc));
    if (transRes.error)  setFetchError("送金データ取得失敗: " + transRes.error.message);
    else setTransfers(transRes.data.map(toLocalTrans));
    if (!pwRes.error && pwRes.data) setAdminPassword(pwRes.data.value);
    if (!budgetRes.error) {
      const map = {};
      budgetRes.data.forEach(b => { map[b.category] = b.amount; });
      setBudgets(map);
    }
    setLoading(false);
  }

  // パスワードをSupabaseに保存
  async function savePassword(newPw) {
    const { error } = await supabase
      .from("settings")
      .update({ value: newPw })
      .eq("key", "admin_password");
    if (error) {
      alert("パスワード保存失敗: " + error.message);
      return;
    }
    setAdminPassword(newPw);
  }

  // 管理者認証
  function requireAdmin(action) {
    if (isAdmin) { action(); return; }
    setAdminAction(()=>action);
    setShowAdminAuth(true);
  }
  function onAdminSuccess() {
    setIsAdmin(true); setShowAdminAuth(false);
    if (adminAction) { adminAction(); setAdminAction(null); }
  }

  // 集計
  const activeExpenses  = expenses.filter(r=>!r.deleted);
  const activeIncomes   = incomes.filter(r=>!r.deleted);
  const trashedExpenses = expenses.filter(r=>r.deleted);
  const trashedIncomes  = incomes.filter(r=>r.deleted);
  const trashCount      = trashedExpenses.length + trashedIncomes.length;

  const accountBalance = ACCOUNTS.reduce((acc, acct) => {
    const inc     = activeIncomes.filter(r=>r.account===acct).reduce((s,r)=>s+r.amount,0);
    const exp     = activeExpenses.filter(r=>r.account===acct&&r.payment==="paid").reduce((s,r)=>s+r.amount,0);
    const transOut= transfers.filter(r=>r.from===acct).reduce((s,r)=>s+r.amount+(r.fee||0),0);
    const transIn = transfers.filter(r=>r.to===acct).reduce((s,r)=>s+r.amount,0);
    acc[acct] = inc - exp - transOut + transIn;
    return acc;
  }, {});

  const totalIncome   = activeIncomes.reduce((s,r)=>s+r.amount,0);
  const totalExpPaid  = activeExpenses.filter(r=>r.payment==="paid").reduce((s,r)=>s+r.amount,0);
  const balance       = totalIncome - totalExpPaid;
  const pendingAmount = activeExpenses.filter(r=>r.approval==="approved"&&r.payment==="unpaid").reduce((s,r)=>s+r.amount,0);
  const pendingCount  = activeExpenses.filter(r=>r.approval==="pending").length;

  const filteredExp = activeExpenses.filter(r=>{
    if (expFilter==="pending_approval") return r.approval==="pending";
    if (expFilter==="approved_unpaid")  return r.approval==="approved"&&r.payment==="unpaid";
    if (expFilter==="paid")             return r.payment==="paid";
    return true;
  });

  // ── 支出操作 ──
  async function submitExpense() {
    const errors={};
    if (!expForm.title.trim())            errors.title="件名を入力してください";
    if (!expForm.requester.trim())        errors.requester="申請者名を入力してください";
    if (!expForm.amount)                  errors.amount="金額を入力してください";
    else if (parseInt(expForm.amount)<=0) errors.amount="金額は1円以上を入力してください";
    setExpErrors(errors);
    if (Object.keys(errors).length>0) return;
    setSaving(true);
    const { data, error } = await supabase.from("requests").insert({
      category:expForm.category, title:expForm.title,
      amount:parseInt(expForm.amount), requester:expForm.requester,
      description:expForm.description, applied_date:today(),
      approved_date:null, paid_date:null,
      approval:"pending", payment:"unpaid", account:null,
      reject_reason:"", admin_note:"", deleted:false,
      fiscal_year:fiscalYear,
    }).select().single();
    if (error) alert("申請失敗: " + error.message);
    else { setExpenses(prev=>[toLocalExp(data),...prev]); setExpForm(emptyExp); setExpErrors({}); setShowExpForm(false); }
    setSaving(false);
  }

  async function updateApproval(id, val, reason="", approvedBy="", approveComment="") {
    setSaving(true);
    const { error } = await supabase.from("requests").update({
      approval:val, reject_reason:reason,
      approved_date: val==="approved" ? today() : (expenses.find(r=>r.id===id)?.approvedDate||null),
      approved_by: val==="approved" ? approvedBy : "",
      approve_comment: val==="approved" ? approveComment : "",
    }).eq("id",id);
    if (error) alert("更新失敗: " + error.message);
    else {
      setExpenses(prev=>prev.map(r=>r.id===id?{...r,approval:val,rejectReason:reason,approvedDate:val==="approved"?today():r.approvedDate,approvedBy:val==="approved"?approvedBy:"",approveComment:val==="approved"?approveComment:""}:r));
      setDetail(d=>d?{...d,approval:val,rejectReason:reason,approvedDate:val==="approved"?today():d.approvedDate,approvedBy:val==="approved"?approvedBy:"",approveComment:val==="approved"?approveComment:""}:d);
      setShowRejectInput(false); setRejectReason("");
    }
    setSaving(false);
  }

  async function revertToPending(id) {
    setSaving(true);
    const { error } = await supabase.from("requests").update({ approval:"pending", payment:"unpaid", approved_date:null, paid_date:null, account:null, approved_by:"", approve_comment:"" }).eq("id",id);
    if (error) alert("差戻し失敗: " + error.message);
    else {
      setExpenses(prev=>prev.map(r=>r.id===id?{...r,approval:"pending",payment:"unpaid",approvedDate:null,paidDate:null,account:null,approvedBy:"",approveComment:""}:r));
      setDetail(d=>d?{...d,approval:"pending",payment:"unpaid",approvedDate:null,paidDate:null,account:null,approvedBy:"",approveComment:""}:d);
    }
    setSaving(false);
  }

  async function confirmPayment(account) {
    if (!payTarget) return;
    setSaving(true);
    const { error } = await supabase.from("requests").update({ payment:"paid", paid_date:today(), account }).eq("id",payTarget.id);
    if (error) alert("更新失敗: " + error.message);
    else {
      setExpenses(prev=>prev.map(r=>r.id===payTarget.id?{...r,payment:"paid",paidDate:today(),account}:r));
      setDetail(d=>d&&d.id===payTarget.id?{...d,payment:"paid",paidDate:today(),account}:d);
      setPayTarget(null);
    }
    setSaving(false);
  }

  async function revertPayment(id) {
    setSaving(true);
    const { error } = await supabase.from("requests").update({ payment:"unpaid", paid_date:null, account:null }).eq("id",id);
    if (error) alert("更新失敗: " + error.message);
    else {
      setExpenses(prev=>prev.map(r=>r.id===id?{...r,payment:"unpaid",paidDate:null,account:null}:r));
      setDetail(d=>d?{...d,payment:"unpaid",paidDate:null,account:null}:d);
      setShowUnpaidConfirm(false);
    }
    setSaving(false);
  }

  async function saveExpEdit(id, form) {
    setSaving(true);
    const { error } = await supabase.from("requests").update({
      category:form.category, title:form.title, amount:form.amount,
      requester:form.requester, description:form.description,
      approval:form.approval, payment:form.payment,
      applied_date:form.appliedDate||null, approved_date:form.approvedDate||null, paid_date:form.paidDate||null,
      account:form.account||null, reject_reason:form.rejectReason||"", admin_note:form.adminNote||"",
    }).eq("id",id);
    if (error) alert("更新失敗: " + error.message);
    else {
      setExpenses(prev=>prev.map(r=>r.id===id?{...r,...form}:r));
      setDetail(d=>d?{...d,...form}:d);
    }
    setEditExpItem(null); setSaving(false);
  }

  async function softDeleteExpense(id) {
    setSaving(true);
    const { error } = await supabase.from("requests").update({ deleted:true }).eq("id",id);
    if (error) alert("削除失敗: " + error.message);
    else { setExpenses(prev=>prev.map(r=>r.id===id?{...r,deleted:true}:r)); setDetail(null); setConfirmDelete(false); }
    setSaving(false);
  }
  async function restoreExpense(id) {
    setSaving(true);
    const { error } = await supabase.from("requests").update({ deleted:false }).eq("id",id);
    if (error) alert("復元失敗: " + error.message);
    else setExpenses(prev=>prev.map(r=>r.id===id?{...r,deleted:false}:r));
    setSaving(false);
  }
  async function hardDeleteExpense(id) {
    setSaving(true);
    const { error } = await supabase.from("requests").delete().eq("id",id);
    if (error) alert("完全削除失敗: " + error.message);
    else setExpenses(prev=>prev.filter(r=>r.id!==id));
    setSaving(false);
  }

  // ── 収入操作 ──
  async function submitIncome() {
    if (!incForm.amount||!incForm.date) return;
    setSaving(true);
    const { data, error } = await supabase.from("incomes").insert({
      category:incForm.category, amount:parseInt(incForm.amount),
      date:incForm.date, note:incForm.note, account:incForm.account,
      deleted:false, fiscal_year:fiscalYear,
    }).select().single();
    if (error) alert("追加失敗: " + error.message);
    else { setIncomes(prev=>[toLocalInc(data),...prev]); setIncForm(emptyInc); setShowIncForm(false); }
    setSaving(false);
  }
  async function saveIncEdit(id, form) {
    setSaving(true);
    const { error } = await supabase.from("incomes").update({ category:form.category, amount:form.amount, date:form.date, note:form.note, account:form.account }).eq("id",id);
    if (error) alert("更新失敗: " + error.message);
    else setIncomes(prev=>prev.map(r=>r.id===id?{...r,...form}:r));
    setEditIncItem(null); setSaving(false);
  }
  async function softDeleteIncome(id) {
    setSaving(true);
    const { error } = await supabase.from("incomes").update({ deleted:true }).eq("id",id);
    if (error) alert("削除失敗: " + error.message);
    else { setIncomes(prev=>prev.map(r=>r.id===id?{...r,deleted:true}:r)); setConfirmIncDelete(null); }
    setSaving(false);
  }
  async function restoreIncome(id) {
    setSaving(true);
    const { error } = await supabase.from("incomes").update({ deleted:false }).eq("id",id);
    if (error) alert("復元失敗: " + error.message);
    else setIncomes(prev=>prev.map(r=>r.id===id?{...r,deleted:false}:r));
    setSaving(false);
  }
  async function hardDeleteIncome(id) {
    setSaving(true);
    const { error } = await supabase.from("incomes").delete().eq("id",id);
    if (error) alert("完全削除失敗: " + error.message);
    else setIncomes(prev=>prev.filter(r=>r.id!==id));
    setSaving(false);
  }

  // ── 送金操作 ──
  async function doTransfer(from, to, amount, fee) {
    setSaving(true);
    const { data, error } = await supabase.from("transfers").insert({
      from_account:from, to_account:to, amount, fee:fee||0, date:today(), fiscal_year:fiscalYear,
    }).select().single();
    if (error) alert("送金記録失敗: " + error.message);
    else { setTransfers(prev=>[toLocalTrans(data),...prev]); setShowTransfer(false); }
    setSaving(false);
  }

  // ── 予算操作 ──
  async function saveBudgets(newBudgets) {
    setSaving(true);
    const upsertData = Object.entries(newBudgets)
      .filter(([, v]) => parseInt(v) > 0)
      .map(([category, amount]) => ({ fiscal_year:fiscalYear, category, amount:parseInt(amount) }));
    const { error } = await supabase.from("budgets").upsert(upsertData, { onConflict:"fiscal_year,category" });
    if (error) alert("予算保存失敗: " + error.message);
    else {
      const map = {};
      upsertData.forEach(b => { map[b.category] = b.amount; });
      setBudgets(map);
      setShowBudgetEdit(false);
    }
    setSaving(false);
  }

  // CSV
  function exportCSV() {
    const rows=[
      ["種別","カテゴリ","件名/備考","金額","手数料","申請日","承認日","支払日","口座","申請者","承認","支払","却下理由","管理者メモ"],
      ...activeIncomes.map(r=>["収入",r.category,r.note,r.amount,"",r.date,"","",r.account||"","会計","-","-","",""]),
      ...activeExpenses.map(r=>["支出",r.category,r.title,r.amount,"",r.appliedDate||"",r.approvedDate||"",r.paidDate||"",r.account||"未設定",r.requester,STATUS_LABELS.approval[r.approval],STATUS_LABELS.payment[r.payment],r.rejectReason||"",r.adminNote||""]),
      ...transfers.map(t=>["送金","",`${t.from}→${t.to}`,t.amount,t.fee||0,t.date,"","","","","-","-","",""]),
    ];
    const bom="\uFEFF";
    const csv=rows.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob([bom+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`町内会会計_${fiscalYear}年度_${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const card={ background:"#fff", borderRadius:12, padding:16, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" };
  const closeDetail=()=>{setDetail(null);setConfirmDelete(false);setShowRejectInput(false);setRejectReason("");setShowUnpaidConfirm(false);setShowApproveInput(false);setApprovedBy("");setApproveComment("");setApproveError("");};

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", fontFamily:"sans-serif", color:"#6B7280", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:32 }}>⏳</div>
      <div>読み込み中…</div>
    </div>
  );

  return (
    <div style={{ fontFamily:"'Noto Sans JP',sans-serif", background:"#F8F7F4", minHeight:"100vh" }}>
      {showAdminAuth && <AdminAuthModal onSuccess={onAdminSuccess} onClose={()=>setShowAdminAuth(false)} adminPassword={adminPassword} />}
      {showChangePw  && <ChangePasswordModal adminPassword={adminPassword} onSave={savePassword} onClose={()=>setShowChangePw(false)} />}
      {showBudgetEdit && <BudgetEditModal budgets={budgets} onSave={saveBudgets} onClose={()=>setShowBudgetEdit(false)} saving={saving} />}
      {editExpItem   && <ExpenseEditModal item={editExpItem} isAdmin={isAdmin} onSave={f=>saveExpEdit(editExpItem.id,f)} onClose={()=>setEditExpItem(null)} />}
      {editIncItem   && <IncomeEditModal  item={editIncItem} onSave={f=>saveIncEdit(editIncItem.id,f)} onClose={()=>setEditIncItem(null)} />}
      {showTransfer  && <TransferModal accountBalance={accountBalance} onConfirm={doTransfer} onClose={()=>setShowTransfer(false)} />}
      {payTarget     && <PayAccountModal expense={payTarget} accountBalance={accountBalance} onConfirm={confirmPayment} onClose={()=>setPayTarget(null)} />}

      {/* ヘッダー */}
      <div style={{ background:"#1C3557", padding:"16px 24px", color:"#fff" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", maxWidth:820, margin:"0 auto" }}>
          <div>
            <div style={{ fontSize:11, letterSpacing:3, opacity:0.6, marginBottom:2 }}>CHONAIKAI</div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ fontSize:19, fontWeight:700 }}>町内会　会計管理</div>
              <select value={fiscalYear} onChange={e=>{
                setFiscalYear(parseInt(e.target.value)); setTab("summary");
                setDetail(null); setPayTarget(null); setConfirmDelete(false); setShowRejectInput(false); setShowUnpaidConfirm(false);
              }} style={{ background:"rgba(255,255,255,0.15)", color:"#fff", border:"1px solid rgba(255,255,255,0.3)", borderRadius:6, padding:"3px 8px", fontSize:13, fontFamily:"inherit", cursor:"pointer" }}>
                {FISCAL_YEARS.map(y=><option key={y} value={y} style={{ background:"#1C3557" }}>{y}年度</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {saving && <span style={{ fontSize:11, opacity:0.7 }}>保存中…</span>}
            {isAdmin ? (
              <>
                <span style={{ background:"#E8A020", color:"#fff", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>🔓 管理者モード</span>
                <button onClick={()=>setShowChangePw(true)} style={{ background:"rgba(255,255,255,0.15)", color:"#fff", border:"none", padding:"8px 12px", borderRadius:8, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>🔑 PW変更</button>
                <button onClick={()=>setIsAdmin(false)} style={{ background:"rgba(255,255,255,0.15)", color:"#fff", border:"none", padding:"8px 12px", borderRadius:8, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>ログアウト</button>
              </>
            ) : (
              <button onClick={()=>requireAdmin(()=>{})} style={{ background:"rgba(255,255,255,0.15)", color:"#fff", border:"1.5px solid rgba(255,255,255,0.3)", padding:"8px 14px", borderRadius:8, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>🔐 管理者</button>
            )}
          </div>
        </div>
      </div>

      {fetchError && (
        <div style={{ background:"#FEE2E2", color:"#991B1B", padding:"10px 24px", fontSize:13, display:"flex", justifyContent:"space-between" }}>
          {fetchError}
          <button onClick={fetchAll} style={{ background:"#991B1B", color:"#fff", border:"none", padding:"3px 12px", borderRadius:6, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>再読込</button>
        </div>
      )}

      {/* タブ */}
      <div style={{ background:"#fff", borderBottom:"1.5px solid #E5E7EB" }}>
        <div style={{ display:"flex", maxWidth:820, margin:"0 auto", overflowX:"auto" }}>
          {[["summary","📊 サマリー"],["expense","💸 支出"],["income","💰 収入"],["budget","📋 予算"]].map(([val,label])=>(
            <button key={val} onClick={()=>setTab(val)} style={{ position:"relative", padding:"13px 20px", border:"none", background:"none", cursor:"pointer", fontFamily:"inherit", fontSize:14, fontWeight:tab===val?700:400, color:tab===val?"#1C3557":"#6B7280", borderBottom:tab===val?"3px solid #1C3557":"3px solid transparent", whiteSpace:"nowrap" }}>
              {label}
              {val==="expense"&&pendingCount>0&&<span style={{ position:"absolute", top:8, right:4, background:"#EF4444", color:"#fff", fontSize:10, fontWeight:700, minWidth:16, height:16, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px" }}>{pendingCount}</span>}
            </button>
          ))}
          {isAdmin && [["accounts","🏦 口座管理"],["trash","🗑 ゴミ箱"]].map(([val,label])=>(
            <button key={val} onClick={()=>setTab(val)} style={{ position:"relative", padding:"13px 20px", border:"none", background:"none", cursor:"pointer", fontFamily:"inherit", fontSize:14, fontWeight:tab===val?700:400, color:tab===val?(val==="trash"?"#991B1B":"#1C3557"):"#6B7280", borderBottom:tab===val?`3px solid ${val==="trash"?"#991B1B":"#1C3557"}`:"3px solid transparent", whiteSpace:"nowrap" }}>
              {label}
              {val==="trash"&&trashCount>0&&<span style={{ position:"absolute", top:8, right:4, background:"#9CA3AF", color:"#fff", fontSize:10, fontWeight:700, minWidth:16, height:16, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px" }}>{trashCount}</span>}
            </button>
          ))}
          {isAdmin && <button onClick={exportCSV} style={{ marginLeft:"auto", padding:"13px 18px", border:"none", background:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, color:"#6B7280", whiteSpace:"nowrap" }}>📥 CSV</button>}
        </div>
      </div>

      <div style={{ maxWidth:820, margin:"0 auto", padding:"20px 16px" }}>

        {/* ═══ サマリー ═══ */}
        {tab==="summary" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
              {ACCOUNTS.map(acct=>(
                <div key={acct} style={{ ...card, borderTop:`3px solid ${ACCOUNT_COLORS[acct]}`, textAlign:"center", padding:"18px 10px" }}>
                  <div style={{ fontSize:20, marginBottom:4 }}>{ACCOUNT_ICONS[acct]}</div>
                  <div style={{ fontSize:11, color:"#6B7280", marginBottom:6 }}>{acct}</div>
                  <div style={{ fontSize:18, fontWeight:700, color:accountBalance[acct]<0?"#EF4444":"#1C3557" }}>¥{accountBalance[acct].toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div style={{ ...card, borderTop:"4px solid #1C3557", textAlign:"center", padding:24 }}>
              <div style={{ fontSize:13, color:"#6B7280", marginBottom:6 }}>{fiscalYear}年度　合計残高</div>
              <div style={{ fontSize:42, fontWeight:700, color:"#1C3557" }}>¥{balance.toLocaleString()}</div>
              <div style={{ fontSize:12, color:"#9CA3AF", marginTop:6 }}>収入合計 ¥{totalIncome.toLocaleString()} ／ 支出済合計 ¥{totalExpPaid.toLocaleString()}</div>
              {pendingAmount>0&&<div style={{ marginTop:10, background:"#FFF3CD", borderRadius:8, padding:"8px 16px", display:"inline-block", fontSize:13, color:"#856404" }}>⚠ 承認済・未払い　¥{pendingAmount.toLocaleString()} が残っています</div>}
            </div>
            <div style={card}>
              <div style={{ fontSize:13, fontWeight:700, color:"#374151", marginBottom:12 }}>収支バランス</div>
              {[{label:"収入合計",value:totalIncome,color:"#10B981"},{label:"支出済み",value:totalExpPaid,color:"#EF4444"}].map(({label,value,color})=>{
                const max=Math.max(totalIncome,totalExpPaid,1);
                return (
                  <div key={label} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                      <span style={{ color:"#6B7280" }}>{label}</span><span style={{ fontWeight:700 }}>¥{value.toLocaleString()}</span>
                    </div>
                    <div style={{ background:"#F3F4F6", borderRadius:99, height:12, overflow:"hidden" }}>
                      <div style={{ width:`${(value/max*100).toFixed(1)}%`, background:color, height:"100%", borderRadius:99 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 予算サマリー */}
            {(()=>{
              const incBudget = INCOME_CATEGORIES.reduce((s,c)=>s+(budgets[c]||0),0);
              const expBudget = EXPENSE_CATEGORIES.reduce((s,c)=>s+(budgets[c]||0),0);
              if (incBudget===0 && expBudget===0) return null;
              return (
                <div style={card}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#374151", marginBottom:12 }}>📋 予算進捗</div>
                  {[
                    { label:"収入", budget:incBudget, actual:totalIncome, color:"#10B981", isIncome:true },
                    { label:"支出", budget:expBudget, actual:totalExpPaid, color:"#3B82F6", isIncome:false },
                  ].filter(x=>x.budget>0).map(({label,budget,actual,color,isIncome})=>{
                    const pct = Math.min((actual/budget*100),100);
                    const over = actual > budget;
                    // 収入超過は良いこと（緑）、支出超過は問題（赤）
                    const overColor = isIncome ? "#10B981" : "#EF4444";
                    const overLabel = isIncome ? `＋¥${(actual-budget).toLocaleString()} 超過達成` : `⚠ ¥${(actual-budget).toLocaleString()} 超過`;
                    return (
                      <div key={label} style={{ marginBottom:14 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                          <span style={{ color:"#374151", fontWeight:600 }}>{label}予算　¥{budget.toLocaleString()}</span>
                          <span style={{ color:"#6B7280" }}>実績 ¥{actual.toLocaleString()}</span>
                        </div>
                        <div style={{ background:"#F3F4F6", borderRadius:99, height:10, overflow:"hidden", marginBottom:3 }}>
                          <div style={{ width:`${pct.toFixed(1)}%`, background: over?overColor:color, height:"100%", borderRadius:99 }} />
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}>
                          <span style={{ color:"#9CA3AF" }}>{pct.toFixed(0)}%{isIncome?"達成":"使用"}</span>
                          <span style={{ color: over?overColor:"#9CA3AF", fontWeight:over?600:400 }}>
                            {over ? overLabel : `残り ¥${(budget-actual).toLocaleString()}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize:11, color:"#9CA3AF", textAlign:"right", marginTop:4 }}>
                    詳細は「📋 予算」タブへ
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ═══ 支出 ═══ */}
        {tab==="expense" && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#1C3557" }}>支出申請一覧　<span style={{ fontSize:12, color:"#9CA3AF", fontWeight:400 }}>{fiscalYear}年度</span></div>
              <button onClick={()=>setShowExpForm(true)} style={{ background:"#E8A020", color:"#fff", border:"none", padding:"10px 18px", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>＋ 支払い申請</button>
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
              {[["all","すべて"],["pending_approval","承認待ち"],["approved_unpaid","支払い待ち"],["paid","支払済み"]].map(([val,label])=>(
                <button key={val} onClick={()=>setExpFilter(val)} style={{ padding:"6px 16px", borderRadius:20, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:500, background:expFilter===val?"#1C3557":"#fff", color:expFilter===val?"#fff":"#4B5563", boxShadow:"0 1px 3px rgba(0,0,0,0.08)" }}>{label}</button>
              ))}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {filteredExp.length===0&&<div style={{ textAlign:"center", padding:40, color:"#9CA3AF" }}>該当する申請がありません</div>}
              {filteredExp.map(r=>(
                <div key={r.id} onClick={()=>{setDetail(r);setConfirmDelete(false);setShowRejectInput(false);setRejectReason("");setShowUnpaidConfirm(false);}} style={{ ...card, cursor:"pointer", borderLeft:r.approval==="pending"?"4px solid #F0AD00":r.approval==="rejected"?"4px solid #EF4444":"4px solid #10B981" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div>
                      <div style={{ fontSize:11, color:"#6B7280", marginBottom:2 }}>{r.category}</div>
                      <div style={{ fontWeight:700, fontSize:15, color:"#111", marginBottom:3 }}>{r.title}</div>
                      <div style={{ fontSize:12, color:"#9CA3AF" }}>{r.requester}</div>
                    </div>
                    <div style={{ fontSize:18, fontWeight:700, color:"#1C3557" }}>¥{r.amount.toLocaleString()}</div>
                  </div>
                  <div style={{ display:"flex", gap:10, marginTop:6, fontSize:11, color:"#9CA3AF", flexWrap:"wrap" }}>
                    {r.appliedDate&&<span>申請: {r.appliedDate}</span>}
                    {r.approvedDate&&<span>承認: {r.approvedDate}{r.approvedBy&&` (${r.approvedBy})`}</span>}
                    {r.paidDate&&<span>支払: {r.paidDate}</span>}
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
                    <Badge type="approval" value={r.approval} /><Badge type="payment" value={r.payment} />
                    {r.account&&<AccountBadge account={r.account} />}
                    {r.adminNote&&<span style={{ fontSize:11, color:"#92400E", background:"#FEF3C7", borderRadius:10, padding:"2px 8px" }}>📝 メモあり</span>}
                  </div>
                  {r.approval==="rejected"&&r.rejectReason&&<div style={{ marginTop:8, fontSize:12, color:"#991B1B", background:"#FEE2E2", borderRadius:6, padding:"4px 10px" }}>却下理由: {r.rejectReason}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ 収入 ═══ */}
        {tab==="income" && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#1C3557" }}>収入一覧　<span style={{ fontSize:12, color:"#9CA3AF", fontWeight:400 }}>{fiscalYear}年度</span></div>
              {isAdmin
                ? <button onClick={()=>setShowIncForm(true)} style={{ background:"#10B981", color:"#fff", border:"none", padding:"10px 18px", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>＋ 収入を追加</button>
                : <button onClick={()=>requireAdmin(()=>setShowIncForm(true))} style={{ background:"#E5E7EB", color:"#6B7280", border:"none", padding:"10px 18px", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>🔐 収入を追加</button>
              }
            </div>
            <div style={{ ...card, marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:"#6B7280", fontSize:13 }}>収入合計</span>
              <span style={{ fontSize:22, fontWeight:700, color:"#10B981" }}>¥{totalIncome.toLocaleString()}</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {activeIncomes.length===0&&<div style={{ textAlign:"center", padding:40, color:"#9CA3AF" }}>収入データがありません</div>}
              {activeIncomes.map(r=>(
                <div key={r.id} style={{ ...card, borderLeft:"4px solid #10B981" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:11, color:"#6B7280", marginBottom:2 }}>{r.category}</div>
                      {r.note&&<div style={{ fontSize:13, color:"#374151", marginBottom:2 }}>{r.note}</div>}
                      <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:2 }}>
                        <span style={{ fontSize:12, color:"#9CA3AF" }}>{r.date}</span>
                        <AccountBadge account={r.account} />
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ fontSize:18, fontWeight:700, color:"#10B981" }}>¥{r.amount.toLocaleString()}</div>
                      {isAdmin&&(
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={()=>setEditIncItem(r)} style={{ background:"#FEF3C7", color:"#92400E", border:"none", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>✏</button>
                          {confirmIncDelete===r.id?(
                            <>
                              <button onClick={()=>setConfirmIncDelete(null)} style={{ padding:"4px 10px", borderRadius:6, border:"1.5px solid #E5E7EB", background:"#fff", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>戻す</button>
                              <button onClick={()=>softDeleteIncome(r.id)} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:"#991B1B", color:"#fff", cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:700 }}>削除</button>
                            </>
                          ):(
                            <button onClick={()=>setConfirmIncDelete(r.id)} style={{ background:"#FEE2E2", color:"#991B1B", border:"none", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>削除</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ 口座管理（管理者のみ） ═══ */}
        {tab==="accounts"&&isAdmin&&(
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#1C3557" }}>🏦 口座管理</div>
              <button onClick={()=>setShowTransfer(true)} style={{ background:"#8B5CF6", color:"#fff", border:"none", padding:"10px 18px", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>🔄 口座間送金</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
              {ACCOUNTS.map(acct=>{
                const inc=activeIncomes.filter(r=>r.account===acct).reduce((s,r)=>s+r.amount,0);
                const exp=activeExpenses.filter(r=>r.account===acct&&r.payment==="paid").reduce((s,r)=>s+r.amount,0);
                const transO=transfers.filter(r=>r.from===acct).reduce((s,r)=>s+r.amount+(r.fee||0),0);
                const transI=transfers.filter(r=>r.to===acct).reduce((s,r)=>s+r.amount,0);
                const bal=accountBalance[acct];
                return (
                  <div key={acct} style={{ ...card, borderTop:`3px solid ${ACCOUNT_COLORS[acct]}` }}>
                    <div style={{ textAlign:"center", marginBottom:12 }}>
                      <div style={{ fontSize:24, marginBottom:4 }}>{ACCOUNT_ICONS[acct]}</div>
                      <div style={{ fontSize:13, fontWeight:700 }}>{acct}</div>
                      <div style={{ fontSize:22, fontWeight:700, color:bal<0?"#EF4444":"#1C3557", marginTop:4 }}>¥{bal.toLocaleString()}</div>
                    </div>
                    <div style={{ fontSize:11, color:"#6B7280", display:"flex", flexDirection:"column", gap:3 }}>
                      <div style={{ display:"flex", justifyContent:"space-between" }}><span>入金</span><span style={{ color:"#10B981" }}>+¥{inc.toLocaleString()}</span></div>
                      <div style={{ display:"flex", justifyContent:"space-between" }}><span>支出</span><span style={{ color:"#EF4444" }}>-¥{exp.toLocaleString()}</span></div>
                      {transI>0&&<div style={{ display:"flex", justifyContent:"space-between" }}><span>送金受取</span><span style={{ color:"#10B981" }}>+¥{transI.toLocaleString()}</span></div>}
                      {transO>0&&<div style={{ display:"flex", justifyContent:"space-between" }}><span>送金送出</span><span style={{ color:"#EF4444" }}>-¥{transO.toLocaleString()}</span></div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={card}>
              <div style={{ fontSize:13, fontWeight:700, color:"#374151", marginBottom:12 }}>🔄 送金履歴</div>
              {transfers.length===0
                ? <div style={{ color:"#9CA3AF", fontSize:13, textAlign:"center", padding:"20px 0" }}>送金履歴はありません</div>
                : transfers.map(t=>(
                  <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"#F8F7F4", borderRadius:8, marginBottom:6 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span>{ACCOUNT_ICONS[t.from]}</span><span style={{ fontSize:13, fontWeight:600 }}>{t.from}</span>
                      <span style={{ fontSize:12, color:"#9CA3AF" }}>→</span>
                      <span>{ACCOUNT_ICONS[t.to]}</span><span style={{ fontSize:13, fontWeight:600 }}>{t.to}</span>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:14, fontWeight:700, color:"#1C3557" }}>¥{t.amount.toLocaleString()}</div>
                      {t.fee>0&&<div style={{ fontSize:11, color:"#EF4444" }}>手数料 ¥{t.fee.toLocaleString()}</div>}
                      <div style={{ fontSize:11, color:"#9CA3AF" }}>{t.date}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* ═══ ゴミ箱 ═══ */}
        {tab==="trash"&&isAdmin&&(
          <div>
            <div style={{ background:"#FEE2E2", borderRadius:10, padding:"12px 16px", marginBottom:16, fontSize:13, color:"#991B1B" }}>🗑 ゴミ箱内のデータは復元できます。完全削除すると元に戻せません。</div>
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              {[["expense","💸 支出"],["income","💰 収入"]].map(([val,label])=>(
                <button key={val} onClick={()=>setTrashTab(val)} style={{ padding:"6px 16px", borderRadius:20, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:trashTab===val?700:500, background:trashTab===val?"#991B1B":"#fff", color:trashTab===val?"#fff":"#4B5563", boxShadow:"0 1px 3px rgba(0,0,0,0.08)" }}>{label}</button>
              ))}
            </div>
            {trashTab==="expense"&&(
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {trashedExpenses.length===0&&<div style={{ textAlign:"center", padding:40, color:"#9CA3AF" }}>削除済みの支出申請はありません</div>}
                {trashedExpenses.map(r=>(
                  <div key={r.id} style={{ ...card, borderLeft:"4px solid #9CA3AF", opacity:0.8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <div><div style={{ fontSize:11, color:"#9CA3AF" }}>{r.category}</div><div style={{ fontWeight:700, color:"#6B7280" }}>{r.title}</div><div style={{ fontSize:12, color:"#9CA3AF" }}>{r.requester}</div></div>
                      <div style={{ fontSize:16, fontWeight:700, color:"#9CA3AF" }}>¥{r.amount.toLocaleString()}</div>
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <button onClick={()=>restoreExpense(r.id)} style={{ flex:2, padding:"8px 0", background:"#D1FAE5", color:"#065F46", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>↩ 復元する</button>
                      <button onClick={()=>hardDeleteExpense(r.id)} style={{ flex:1, padding:"8px 0", background:"#FEE2E2", color:"#991B1B", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>完全削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {trashTab==="income"&&(
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {trashedIncomes.length===0&&<div style={{ textAlign:"center", padding:40, color:"#9CA3AF" }}>削除済みの収入はありません</div>}
                {trashedIncomes.map(r=>(
                  <div key={r.id} style={{ ...card, borderLeft:"4px solid #9CA3AF", opacity:0.8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <div><div style={{ fontSize:11, color:"#9CA3AF" }}>{r.category}</div>{r.note&&<div style={{ fontSize:13, color:"#6B7280" }}>{r.note}</div>}<div style={{ fontSize:12, color:"#9CA3AF" }}>{r.date}</div></div>
                      <div style={{ fontSize:16, fontWeight:700, color:"#9CA3AF" }}>¥{r.amount.toLocaleString()}</div>
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <button onClick={()=>restoreIncome(r.id)} style={{ flex:2, padding:"8px 0", background:"#D1FAE5", color:"#065F46", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>↩ 復元する</button>
                      <button onClick={()=>hardDeleteIncome(r.id)} style={{ flex:1, padding:"8px 0", background:"#FEE2E2", color:"#991B1B", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>完全削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ 予算タブ ═══ */}
        {tab==="budget" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* 予算合計サマリー */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {[
                {
                  label:"収入予算合計", icon:"💰", color:"#10B981",
                  budget: INCOME_CATEGORIES.reduce((s,c)=>s+(budgets[c]||0),0),
                  actual: totalIncome,
                },
                {
                  label:"支出予算合計", icon:"💸", color:"#3B82F6",
                  budget: EXPENSE_CATEGORIES.reduce((s,c)=>s+(budgets[c]||0),0),
                  actual: totalExpPaid,
                },
              ].map(({label,icon,color,budget,actual})=>{
                const hasBudget = budget > 0;
                const pct = hasBudget ? Math.min((actual/budget*100),100) : 0;
                const over = hasBudget && actual > budget;
                return (
                  <div key={label} style={{ ...card, borderTop:`3px solid ${color}` }}>
                    <div style={{ fontSize:12, color:"#6B7280", marginBottom:4 }}>{icon} {label}</div>
                    <div style={{ fontSize:20, fontWeight:700, color:"#1C3557" }}>¥{budget.toLocaleString()}</div>
                    {hasBudget && (
                      <>
                        <div style={{ fontSize:11, color:"#9CA3AF", marginTop:4 }}>実績 ¥{actual.toLocaleString()}</div>
                        <div style={{ background:"#F3F4F6", borderRadius:99, height:8, overflow:"hidden", marginTop:6 }}>
                          <div style={{ width:`${pct.toFixed(1)}%`, background: over?(isIncome?"#10B981":"#EF4444"):color, height:"100%", borderRadius:99 }} />
                        </div>
                        <div style={{ fontSize:11, color: over?(isIncome?"#10B981":"#EF4444"):"#9CA3AF", marginTop:3, textAlign:"right" }}>
                          {over ? (isIncome ? `＋¥${(actual-budget).toLocaleString()} 超過達成` : `⚠ ¥${(actual-budget).toLocaleString()} 超過`) : `残り ¥${(budget-actual).toLocaleString()}`}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 管理者：編集ボタン */}
            {isAdmin && (
              <button onClick={()=>setShowBudgetEdit(true)} style={{ background:"#E8A020", color:"#fff", border:"none", padding:"10px 0", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", width:"100%" }}>
                ✏ 予算を編集する
              </button>
            )}

            {/* 収入カテゴリ別予算 */}
            <div style={card}>
              <div style={{ fontSize:13, fontWeight:700, color:"#374151", marginBottom:12 }}>💰 収入カテゴリ別</div>
              {INCOME_CATEGORIES.map(cat=>{
                const actual = activeIncomes.filter(r=>r.category===cat).reduce((s,r)=>s+r.amount,0);
                const budget = budgets[cat]||0;
                const hasBudget = budget>0;
                const pct = hasBudget ? Math.min((actual/budget*100),100) : 0;
                const over = hasBudget && actual>budget;
                if (!hasBudget && actual===0) return null;
                return (
                  <div key={cat} style={{ marginBottom:14 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                      <span style={{ color:"#374151", fontWeight:500 }}>{cat}</span>
                      <span style={{ fontWeight:700, color:"#374151" }}>¥{actual.toLocaleString()}</span>
                    </div>
                    {hasBudget && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#9CA3AF", marginBottom:4 }}>
                        <span>予算 ¥{budget.toLocaleString()}</span>
                        {/* 収入超過は緑（良いこと） */}
                        <span style={{ color:"#10B981", fontWeight:600 }}>
                          {over ? `＋¥${(actual-budget).toLocaleString()} 超過達成` : `残り ¥${(budget-actual).toLocaleString()}`}
                        </span>
                      </div>
                    )}
                    <div style={{ background:"#F3F4F6", borderRadius:99, height:8, overflow:"hidden" }}>
                      <div style={{ width: hasBudget?`${pct.toFixed(1)}%`:"100%", background:"#10B981", height:"100%", borderRadius:99 }} />
                    </div>
                    {hasBudget && <div style={{ fontSize:11, color:"#9CA3AF", marginTop:2, textAlign:"right" }}>{pct.toFixed(0)}%達成</div>}
                  </div>
                );
              })}
              {INCOME_CATEGORIES.every(cat=>(budgets[cat]||0)===0 && activeIncomes.filter(r=>r.category===cat).reduce((s,r)=>s+r.amount,0)===0) && (
                <div style={{ color:"#9CA3AF", fontSize:13, textAlign:"center", padding:"10px 0" }}>収入データまたは予算がありません</div>
              )}
            </div>

            {/* 支出カテゴリ別予算 */}
            <div style={card}>
              <div style={{ fontSize:13, fontWeight:700, color:"#374151", marginBottom:12 }}>💸 支出カテゴリ別（支払済）</div>
              {EXPENSE_CATEGORIES.map(cat=>{
                const actual = activeExpenses.filter(r=>r.category===cat&&r.payment==="paid").reduce((s,r)=>s+r.amount,0);
                const budget = budgets[cat]||0;
                const hasBudget = budget>0;
                const pct = hasBudget ? Math.min((actual/budget*100),100) : 0;
                const over = hasBudget && actual>budget;
                if (!hasBudget && actual===0) return null;
                return (
                  <div key={cat} style={{ marginBottom:14 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                      <span style={{ color:"#374151", fontWeight:500 }}>{cat}</span>
                      <span style={{ fontWeight:700, color: over?"#EF4444":"#374151" }}>¥{actual.toLocaleString()}</span>
                    </div>
                    {hasBudget && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#9CA3AF", marginBottom:4 }}>
                        <span>予算 ¥{budget.toLocaleString()}</span>
                        <span style={{ color: over?"#EF4444":"#10B981", fontWeight:600 }}>
                          {over ? `⚠ ¥${(actual-budget).toLocaleString()} 超過` : `残り ¥${(budget-actual).toLocaleString()}`}
                        </span>
                      </div>
                    )}
                    <div style={{ background:"#F3F4F6", borderRadius:99, height:8, overflow:"hidden" }}>
                      <div style={{ width: hasBudget?`${pct.toFixed(1)}%`:"100%", background: over?"#EF4444":"#3B82F6", height:"100%", borderRadius:99 }} />
                    </div>
                    {hasBudget && <div style={{ fontSize:11, color:"#9CA3AF", marginTop:2, textAlign:"right" }}>{pct.toFixed(0)}%使用</div>}
                  </div>
                );
              })}
              {EXPENSE_CATEGORIES.every(cat=>(budgets[cat]||0)===0 && activeExpenses.filter(r=>r.category===cat&&r.payment==="paid").reduce((s,r)=>s+r.amount,0)===0) && (
                <div style={{ color:"#9CA3AF", fontSize:13, textAlign:"center", padding:"10px 0" }}>支出データまたは予算がありません</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ ゴミ箱 ═══ */}
        {tab==="trash"&&isAdmin&&(
          <div>
            <div style={{ background:"#FEE2E2", borderRadius:10, padding:"12px 16px", marginBottom:16, fontSize:13, color:"#991B1B" }}>🗑 ゴミ箱内のデータは復元できます。完全削除すると元に戻せません。</div>
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              {[["expense","💸 支出"],["income","💰 収入"]].map(([val,label])=>(
                <button key={val} onClick={()=>setTrashTab(val)} style={{ padding:"6px 16px", borderRadius:20, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:trashTab===val?700:500, background:trashTab===val?"#991B1B":"#fff", color:trashTab===val?"#fff":"#4B5563", boxShadow:"0 1px 3px rgba(0,0,0,0.08)" }}>{label}</button>
              ))}
            </div>
            {trashTab==="expense"&&(
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {trashedExpenses.length===0&&<div style={{ textAlign:"center", padding:40, color:"#9CA3AF" }}>削除済みの支出申請はありません</div>}
                {trashedExpenses.map(r=>(
                  <div key={r.id} style={{ ...card, borderLeft:"4px solid #9CA3AF", opacity:0.8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <div><div style={{ fontSize:11, color:"#9CA3AF" }}>{r.category}</div><div style={{ fontWeight:700, color:"#6B7280" }}>{r.title}</div><div style={{ fontSize:12, color:"#9CA3AF" }}>{r.requester}</div></div>
                      <div style={{ fontSize:16, fontWeight:700, color:"#9CA3AF" }}>¥{r.amount.toLocaleString()}</div>
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <button onClick={()=>restoreExpense(r.id)} style={{ flex:2, padding:"8px 0", background:"#D1FAE5", color:"#065F46", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>↩ 復元する</button>
                      <button onClick={()=>hardDeleteExpense(r.id)} style={{ flex:1, padding:"8px 0", background:"#FEE2E2", color:"#991B1B", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>完全削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {trashTab==="income"&&(
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {trashedIncomes.length===0&&<div style={{ textAlign:"center", padding:40, color:"#9CA3AF" }}>削除済みの収入はありません</div>}
                {trashedIncomes.map(r=>(
                  <div key={r.id} style={{ ...card, borderLeft:"4px solid #9CA3AF", opacity:0.8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <div><div style={{ fontSize:11, color:"#9CA3AF" }}>{r.category}</div>{r.note&&<div style={{ fontSize:13, color:"#6B7280" }}>{r.note}</div>}<div style={{ fontSize:12, color:"#9CA3AF" }}>{r.date}</div></div>
                      <div style={{ fontSize:16, fontWeight:700, color:"#9CA3AF" }}>¥{r.amount.toLocaleString()}</div>
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <button onClick={()=>restoreIncome(r.id)} style={{ flex:2, padding:"8px 0", background:"#D1FAE5", color:"#065F46", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>↩ 復元する</button>
                      <button onClick={()=>hardDeleteIncome(r.id)} style={{ flex:1, padding:"8px 0", background:"#FEE2E2", color:"#991B1B", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>完全削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 支出申請モーダル ═══ */}
      {showExpForm&&(
        <Modal onClose={()=>{setShowExpForm(false);setExpErrors({});}}>
          <div style={{ fontWeight:700, fontSize:18, color:"#1C3557", marginBottom:20 }}>支払い申請</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div><Label>支出カテゴリ</Label><SelectField value={expForm.category} onChange={e=>setExpForm(p=>({...p,category:e.target.value}))} options={EXPENSE_CATEGORIES} /></div>
            <div><Label>件名 <span style={{ color:"#EF4444" }}>*</span></Label><InputField value={expForm.title} onChange={e=>setExpForm(p=>({...p,title:e.target.value}))} placeholder="例：清掃用品購入" error={expErrors.title} /></div>
            <div><Label>申請者名 <span style={{ color:"#EF4444" }}>*</span></Label><InputField value={expForm.requester} onChange={e=>setExpForm(p=>({...p,requester:e.target.value}))} placeholder="氏名" error={expErrors.requester} /></div>
            <div>
              <Label>金額（円） <span style={{ color:"#EF4444" }}>*</span></Label>
              <InputField type="number" value={expForm.amount} onChange={e=>setExpForm(p=>({...p,amount:e.target.value}))} placeholder="0" error={expErrors.amount} />
              {expForm.amount&&parseInt(expForm.amount)>=HIGH_AMOUNT_THRESHOLD&&<div style={{ marginTop:6, background:"#FFF3CD", borderRadius:6, padding:"6px 10px", fontSize:12, color:"#856404" }}>⚠ 高額申請（¥{parseInt(expForm.amount).toLocaleString()}）金額を再確認してください。</div>}
            </div>
            <div><Label>内容・備考（任意）</Label>
              <textarea value={expForm.description} onChange={e=>setExpForm(p=>({...p,description:e.target.value}))} rows={3} placeholder="詳細があれば記入"
                style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #E5E7EB", borderRadius:8, fontSize:14, resize:"vertical", boxSizing:"border-box", fontFamily:"inherit", outline:"none" }} />
            </div>
            <div style={{ background:"#F0FFF4", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#065F46" }}>📅 申請日は本日（{today()}）で自動登録されます</div>
          </div>
          <div style={{ display:"flex", gap:10, marginTop:20 }}>
            <button onClick={()=>{setShowExpForm(false);setExpErrors({});}} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
            <button onClick={submitExpense} disabled={saving} style={{ flex:2, padding:12, background:saving?"#9CA3AF":"#1C3557", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:saving?"default":"pointer", fontFamily:"inherit", fontSize:14 }}>{saving?"送信中…":"申請する"}</button>
          </div>
        </Modal>
      )}

      {/* ═══ 収入追加モーダル ═══ */}
      {showIncForm&&(
        <Modal onClose={()=>setShowIncForm(false)}>
          <div style={{ fontWeight:700, fontSize:18, color:"#1C3557", marginBottom:20 }}>収入を追加</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div><Label>収入カテゴリ</Label><SelectField value={incForm.category} onChange={e=>setIncForm(p=>({...p,category:e.target.value}))} options={INCOME_CATEGORIES} /></div>
            <div><Label>金額（円）</Label><InputField type="number" value={incForm.amount} onChange={e=>setIncForm(p=>({...p,amount:e.target.value}))} placeholder="0" /></div>
            <div><Label>日付</Label><InputField type="date" value={incForm.date} onChange={e=>setIncForm(p=>({...p,date:e.target.value}))} /></div>
            <div><Label>💳 入金口座</Label><SelectField value={incForm.account} onChange={e=>setIncForm(p=>({...p,account:e.target.value}))} options={ACCOUNTS} /></div>
            <div><Label>備考（任意）</Label><InputField value={incForm.note} onChange={e=>setIncForm(p=>({...p,note:e.target.value}))} placeholder="例：令和7年度繰越" /></div>
          </div>
          <div style={{ display:"flex", gap:10, marginTop:20 }}>
            <button onClick={()=>setShowIncForm(false)} style={{ flex:1, padding:12, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>キャンセル</button>
            <button onClick={submitIncome} disabled={saving} style={{ flex:2, padding:12, background:saving?"#9CA3AF":"#10B981", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:saving?"default":"pointer", fontFamily:"inherit", fontSize:14 }}>{saving?"保存中…":"追加する"}</button>
          </div>
        </Modal>
      )}

      {/* ═══ 支出詳細モーダル ═══ */}
      {detail&&(
        <Modal onClose={closeDetail}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
            <div style={{ fontSize:11, color:"#6B7280" }}>{detail.category}</div>
            {canEdit(detail,isAdmin)&&<button onClick={()=>setEditExpItem(detail)} style={{ background:"#FEF3C7", color:"#92400E", border:"none", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>✏ 編集</button>}
          </div>
          <div style={{ fontWeight:700, fontSize:18, color:"#1C3557", marginBottom:12 }}>{detail.title}</div>
          <div style={{ background:"#F8F7F4", borderRadius:10, padding:16, marginBottom:16, fontSize:28, fontWeight:700, color:"#1C3557", textAlign:"center" }}>
            ¥{detail.amount.toLocaleString()}
            {detail.amount>=HIGH_AMOUNT_THRESHOLD&&<div style={{ fontSize:12, color:"#856404", fontWeight:400, marginTop:4 }}>⚠ 高額申請</div>}
          </div>
          {detail.description&&<div style={{ color:"#4B5563", fontSize:13, marginBottom:12 }}>{detail.description}</div>}
          <div style={{ ...card, marginBottom:12, padding:12 }}>
            <DateRow label="📝 申請日" value={detail.appliedDate} />
            <DateRow label="✅ 承認日" value={detail.approvedDate} />
            {detail.approvedBy&&<DateRow label="👤 承認者" value={detail.approvedBy} />}
            <DateRow label="💳 支払日" value={detail.paidDate} />
          </div>
          {detail.approveComment&&<div style={{ background:"#D1FAE5", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#065F46", marginBottom:12 }}>💬 <strong>承認コメント：</strong>{detail.approveComment}</div>}
          {detail.adminNote&&<div style={{ background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#92400E", marginBottom:12 }}>🗒 <strong>管理者メモ：</strong>{detail.adminNote}</div>}
          {detail.approval==="rejected"&&detail.rejectReason&&<div style={{ background:"#FEE2E2", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#991B1B", marginBottom:12 }}><strong>却下理由：</strong>{detail.rejectReason}</div>}
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <Badge type="approval" value={detail.approval} /><Badge type="payment" value={detail.payment} />
            {detail.account&&<AccountBadge account={detail.account} />}
          </div>

          {canApproveReject(detail,isAdmin)&&(
            <div style={{ marginBottom:12 }}>
              <Label>🏛 承認処理</Label>
              <div style={{ display:"flex", gap:8 }}>
                {detail.approval!=="approved"&&(
                  <button onClick={()=>{ setShowApproveInput(v=>!v); setShowRejectInput(false); }}
                    style={{ flex:1, padding:"8px 0", borderRadius:7, border:"none", cursor:"pointer", background:showApproveInput?"#D1FAE5":"#E5E7EB", color:showApproveInput?"#065F46":"#374151", fontWeight:600, fontSize:13, fontFamily:"inherit" }}>✓ 承認</button>
                )}
                {detail.approval!=="rejected"&&(
                  <button onClick={()=>{ setShowRejectInput(v=>!v); setShowApproveInput(false); }}
                    style={{ flex:1, padding:"8px 0", borderRadius:7, border:"none", cursor:"pointer", background:showRejectInput?"#FEE2E2":"#E5E7EB", color:showRejectInput?"#991B1B":"#374151", fontWeight:600, fontSize:13, fontFamily:"inherit" }}>✗ 却下</button>
                )}
              </div>

              {/* 承認フォーム */}
              {showApproveInput&&(
                <div style={{ marginTop:10, background:"#F0FFF4", borderRadius:10, padding:14 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#065F46", marginBottom:10 }}>承認内容を入力してください</div>
                  <div style={{ marginBottom:8 }}>
                    <Label>承認者名 <span style={{ color:"#EF4444" }}>*</span></Label>
                    <InputField value={approvedBy} onChange={e=>{ setApprovedBy(e.target.value); setApproveError(""); }} placeholder="承認者の氏名を入力" error={approveError} />
                  </div>
                  <div style={{ marginBottom:10 }}>
                    <Label>コメント（任意）</Label>
                    <InputField value={approveComment} onChange={e=>setApproveComment(e.target.value)} placeholder="承認に関するコメント" />
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>{ setShowApproveInput(false); setApprovedBy(""); setApproveComment(""); setApproveError(""); }}
                      style={{ flex:1, padding:"8px 0", borderRadius:7, border:"1.5px solid #E5E7EB", background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>キャンセル</button>
                    <button onClick={()=>{
                      if (!approvedBy.trim()) { setApproveError("承認者名を入力してください"); return; }
                      updateApproval(detail.id,"approved","",approvedBy,approveComment);
                      setShowApproveInput(false); setApprovedBy(""); setApproveComment(""); setApproveError("");
                    }} disabled={saving}
                      style={{ flex:2, padding:"8px 0", borderRadius:7, border:"none", background:"#10B981", color:"#fff", cursor:saving?"default":"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>承認を確定する</button>
                  </div>
                </div>
              )}

              {/* 却下フォーム */}
              {showRejectInput&&(
                <div style={{ marginTop:8 }}>
                  <InputField value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="却下理由（任意）" />
                  <button onClick={()=>updateApproval(detail.id,"rejected",rejectReason)} disabled={saving}
                    style={{ width:"100%", marginTop:8, padding:"8px 0", background:"#EF4444", color:"#fff", border:"none", borderRadius:7, fontWeight:700, fontSize:13, cursor:saving?"default":"pointer", fontFamily:"inherit" }}>却下を確定する</button>
                </div>
              )}
            </div>
          )}

          {canRevert(detail,isAdmin)&&(
            <div style={{ marginBottom:12 }}>
              <button onClick={()=>requireAdmin(()=>revertToPending(detail.id))} disabled={saving}
                style={{ width:"100%", padding:"8px 0", borderRadius:7, border:"none", cursor:saving?"default":"pointer", background:"#E5E7EB", color:"#374151", fontWeight:600, fontSize:13, fontFamily:"inherit" }}>
                ↩ 差戻し（承認待ちに戻す）
              </button>
            </div>
          )}

          {detail.approval==="approved"&&detail.payment==="unpaid"&&(
            <div style={{ marginBottom:12 }}>
              <Label>💴 会計処理 {!isAdmin&&"🔐"}</Label>
              <button onClick={()=>requireAdmin(()=>setPayTarget(detail))} disabled={saving}
                style={{ width:"100%", padding:"10px 0", borderRadius:7, border:"none", cursor:saving?"default":"pointer", background:"#1C3557", color:"#fff", fontWeight:700, fontSize:13, fontFamily:"inherit" }}>
                💳 口座を選んで支払い済みにする
              </button>
            </div>
          )}

          {detail.payment==="paid"&&isAdmin&&(
            <div style={{ marginBottom:12 }}>
              {showUnpaidConfirm?(
                <div style={{ background:"#FFF3CD", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:13, color:"#856404", marginBottom:8 }}>⚠ 支払い済みを取り消します。よろしいですか？</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>setShowUnpaidConfirm(false)} style={{ flex:1, padding:"8px 0", borderRadius:7, border:"1.5px solid #E5E7EB", background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>キャンセル</button>
                    <button onClick={()=>revertPayment(detail.id)} disabled={saving} style={{ flex:1, padding:"8px 0", borderRadius:7, border:"none", background:"#F59E0B", color:"#fff", cursor:saving?"default":"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>取り消す</button>
                  </div>
                </div>
              ):(
                <button onClick={()=>setShowUnpaidConfirm(true)} style={{ width:"100%", padding:"8px 0", borderRadius:7, border:"none", cursor:"pointer", background:"#E5E7EB", color:"#374151", fontWeight:600, fontSize:13, fontFamily:"inherit" }}>未払いに戻す</button>
              )}
            </div>
          )}

          {canDelete(detail,isAdmin)&&(
            confirmDelete?(
              <div style={{ background:"#FEE2E2", borderRadius:10, padding:14, marginBottom:10 }}>
                <div style={{ fontSize:13, color:"#991B1B", fontWeight:600, marginBottom:6 }}>ゴミ箱に移動しますか？</div>
                <div style={{ fontSize:12, color:"#991B1B", marginBottom:10 }}>管理者ページから復元できます。</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>setConfirmDelete(false)} style={{ flex:1, padding:"8px 0", borderRadius:7, border:"1.5px solid #E5E7EB", background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>キャンセル</button>
                  <button onClick={()=>softDeleteExpense(detail.id)} disabled={saving} style={{ flex:1, padding:"8px 0", borderRadius:7, border:"none", background:"#991B1B", color:"#fff", cursor:saving?"default":"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>ゴミ箱へ</button>
                </div>
              </div>
            ):(
              <button onClick={()=>setConfirmDelete(true)} style={{ width:"100%", padding:10, border:"none", borderRadius:8, background:"#FEE2E2", color:"#991B1B", cursor:"pointer", fontFamily:"inherit", fontSize:14, fontWeight:600, marginBottom:8 }}>🗑 この申請を削除</button>
            )
          )}

          <button onClick={closeDetail} style={{ width:"100%", padding:10, border:"1.5px solid #E5E7EB", borderRadius:8, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:14 }}>閉じる</button>
        </Modal>
      )}
    </div>
  );
}
