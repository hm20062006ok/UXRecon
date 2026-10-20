import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface SafeInputRequest {
  purpose: string;
  fieldLabel: string;
  isPassword?: boolean | undefined;
}

export type InputProvider = (request: SafeInputRequest) => Promise<string>;

/** Keeps track of inputs during an exploration session (e.g. repeated passwords match) */
const sessionFormMemory = new Map<string, string>();

export function clearSessionFormMemory(): void {
  sessionFormMemory.clear();
}

/**
 * Generates an intelligent, context-aware mock value for mobile form inputs
 * supporting both English and Chinese UI labels.
 */
export function generateSmartFormValue(fieldLabel: string, purpose = "", isPassword = false): string {
  const label = `${fieldLabel} ${purpose}`.toLowerCase();

  // Password confirmation / repeat
  if (
    label.includes("confirm") ||
    label.includes("repeat") ||
    label.includes("again") ||
    label.includes("re-enter") ||
    label.includes("确认密码") ||
    label.includes("重复密码") ||
    label.includes("再次输入")
  ) {
    return sessionFormMemory.get("last_password") ?? "Pass123456!";
  }

  // Password / Pin / Passcode
  if (
    isPassword ||
    label.includes("password") ||
    label.includes("pwd") ||
    label.includes("passcode") ||
    label.includes("pin") ||
    label.includes("密码")
  ) {
    const pwd = "Pass123456!";
    sessionFormMemory.set("last_password", pwd);
    return pwd;
  }

  // Wallet / Account / Name / Username
  if (
    label.includes("wallet name") ||
    label.includes("wallet") ||
    label.includes("account") ||
    label.includes("name") ||
    label.includes("user") ||
    label.includes("钱包名") ||
    label.includes("钱包名称") ||
    label.includes("用户名") ||
    label.includes("名称")
  ) {
    return "MyWallet_01";
  }

  // Amount / Balance / Value
  if (
    label.includes("amount") ||
    label.includes("value") ||
    label.includes("quantity") ||
    label.includes("金额") ||
    label.includes("数量")
  ) {
    return "100";
  }

  // Search / Query / Filter
  if (
    label.includes("search") ||
    label.includes("query") ||
    label.includes("find") ||
    label.includes("搜索") ||
    label.includes("查找")
  ) {
    return "USDT";
  }

  // Email
  if (label.includes("email") || label.includes("mail") || label.includes("邮箱")) {
    return "demo@example.com";
  }

  // Phone
  if (label.includes("phone") || label.includes("mobile") || label.includes("手机")) {
    return "13800000000";
  }

  return "TestInput";
}

/**
 * Prompts user on terminal for form field input with automatic fallback
 */
export async function promptUserForFormField(
  fieldLabel: string,
  purpose = "",
  isPassword = false,
  timeoutMs = 30_000,
): Promise<string> {
  const smartDefault = generateSmartFormValue(fieldLabel, purpose, isPassword);

  // If running non-interactively or redirected stdin, use smart default
  if (!process.stdin.isTTY) {
    return smartDefault;
  }

  const promptMsg = `\n📝 [Form Input Request]\n  Field: "${fieldLabel}" (Purpose: ${purpose || "input"})\n  Enter value (Press [Enter] to use default [${isPassword ? "******" : smartDefault}]): `;

  try {
    const rl = readline.createInterface({ input, output });

    const answerPromise = rl.question(promptMsg).then((ans) => {
      rl.close();
      const trimmed = ans.trim();
      return trimmed.length > 0 ? trimmed : smartDefault;
    });

    const timeoutPromise = new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        rl.close();
        output.write(`\n(Auto-filled with default: ${smartDefault})\n`);
        resolve(smartDefault);
      }, timeoutMs);
      // Unref so process doesn't hang
      timer.unref?.();
    });

    return await Promise.race([answerPromise, timeoutPromise]);
  } catch {
    return smartDefault;
  }
}

/** Default input provider that auto-generates smart values */
export const defaultMockInputProvider: InputProvider = (req) => {
  return Promise.resolve(generateSmartFormValue(req.fieldLabel, req.purpose, req.isPassword));
};
