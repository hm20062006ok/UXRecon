export interface SafeInputRequest {
  purpose: string;
  fieldLabel: string;
}

export type InputProvider = (request: SafeInputRequest) => Promise<string | null>;

/** Default provider that returns safe mock values for non-sensitive exploration */
export const defaultMockInputProvider: InputProvider = (req) => {
  const label = req.fieldLabel.toLowerCase();
  if (label.includes("search") || label.includes("query") || label.includes("find")) {
    return Promise.resolve("test");
  }
  return Promise.resolve(null);
};
