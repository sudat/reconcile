import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

// Vercel Blob クライアントアップロード用のトークン発行 + 完了通知ハンドラ
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // 必要に応じて認可を追加（未ログイン拒否など）
        return {
          allowedContentTypes: [
            // XLSX想定だが、仕向けシステム次第で可変
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            // 一部Excelは下記の古いMIMEで送ってくることがある
            "application/vnd.ms-excel",
          ],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // 必要に応じてDB記録等を実装
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}

