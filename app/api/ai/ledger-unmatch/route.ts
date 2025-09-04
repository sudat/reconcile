import OpenAI from "openai";

export const runtime = "nodejs"; // 明示（EdgeではなくNodeで実行）

type DaySummary = { date8: string; sumA: number; sumB: number; diff: number };
type AnalysisItem = {
  side: "A" | "B";
  day: string; // yyyymmdd
  subAccountCode: string;
  subAccountName: string;
  amountSigned: number;
  debit: number;
  credit: number;
  voucherNo: string;
  description: string;
  rowIndex: number;
};

type Payload = {
  period: string;
  branchA: string;
  branchB: string;
  daySummary: DaySummary[];
  itemsA: AnalysisItem[];
  itemsB: AnalysisItem[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload | null;
    if (!body)
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_body" }),
        { status: 400 }
      );
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "missing_OPENAI_API_KEY" }),
        { status: 500 }
      );
    }

    // トークン節約のため大型入力はサンプリング
    const sample = <T>(arr: T[], max: number) =>
      arr.length > max ? arr.slice(0, max) : arr;
    const itemsA = sample(body.itemsA, 300);
    const itemsB = sample(body.itemsB, 300);
    const daySummary = sample(
      body.daySummary.filter((d) => d.diff !== 0),
      62
    ); // 2ヶ月分程度の上限

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const sys = `あなたは日本語で回答する会計アナリストです。目的は「本支店勘定の元帳A/Bのアンマッチ結果」から、\n- どの日付・どの補助科目で、どちら側(A/B)がいくら過不足か\n- データの特徴から推測できる原因仮説（例: 日付ズレ、相手先ミス、逆仕訳、税額差）\n- 次に人が確認すべき観点\nを指し示すことです。金額は千円区切りで表記してください。`;

    const user = {
      period: body.period,
      branchA: body.branchA,
      branchB: body.branchB,
      daySummary,
      examples: {
        a: itemsA.map(
          ({
            day,
            subAccountCode,
            subAccountName,
            amountSigned,
            voucherNo,
          }) => ({
            day,
            sub: `${subAccountCode}:${subAccountName}`,
            amountSigned,
            voucherNo,
          })
        ),
        b: itemsB.map(
          ({
            day,
            subAccountCode,
            subAccountName,
            amountSigned,
            voucherNo,
          }) => ({
            day,
            sub: `${subAccountCode}:${subAccountName}`,
            amountSigned,
            voucherNo,
          })
        ),
      },
    };

    const prompt = `入力(JSON):\n${JSON.stringify(
      user
    )}\n\n出力フォーマット:\n- 概要: 全体の差額傾向（A合計 vs B合計、ズレ日数）\n- 主要ズレTOP3: 「YYYY-MM-DD / 補助(任意) / A:+X, B:-Y, 差額=Z」\n- 典型原因(推定): 箇条書き 2-4件\n- 次の確認ステップ: 箇条書き 2-4件`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      // temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: prompt },
      ],
    });

    const text =
      completion.choices[0]?.message?.content?.trim() ||
      "要約を生成できませんでした。";
    return new Response(JSON.stringify({ ok: true, summary: text }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
      { status: 500 }
    );
  }
}
