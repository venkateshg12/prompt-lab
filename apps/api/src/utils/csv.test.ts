import { describe, it, expect } from "vitest";
import {
  csvText,
  csvNumber,
  csvLine,
  UTF8_BOM,
} from "./csv";

describe("utils/csv", () => {
  it("neutralises spreadsheet formula injection attempts with leading single quote and quotes", () => {
    expect(csvText("=1+1")).toBe("\"'=1+1\"");
    expect(csvText("+SUM(A1:A10)")).toBe("\"'+SUM(A1:A10)\"");
    expect(csvText("@malicious_cmd")).toBe("\"'@malicious_cmd\"");
    expect(csvText("\tcmd")).toBe("\"'\tcmd\"");
  });

  it("escapes quotes and newlines in text according to RFC 4180", () => {
    expect(csvText('Item with "quotes"')).toBe('"Item with ""quotes"""');
    expect(csvText("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    expect(csvText("City, State")).toBe('"City, State"');
  });

  it("leaves normal text untouched without unnecessary quotes", () => {
    expect(csvText("Invoice 101")).toBe("Invoice 101");
    expect(csvText("ACME Corp")).toBe("ACME Corp");
    expect(csvText("")).toBe("");
    expect(csvText(null)).toBe("");
  });

  it("formats numbers and leaves negative numbers untouched", () => {
    expect(csvNumber(-50)).toBe("-50");
    expect(csvNumber(100)).toBe("100");
    expect(csvNumber(null)).toBe("");
  });

  it("formats csvLine with CRLF and includes UTF8_BOM", () => {
    expect(UTF8_BOM).toBe("﻿");
    expect(csvLine(["a", "b", "c"])).toBe("a,b,c\r\n");
  });

  // Prompt Lab: postings are third-party text and can start with anything.
  it("keeps a posting that starts with =HYPERLINK( as text, and Hindi / ₹ untouched", () => {
    expect(csvText('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csvText("₹25,000 प्रति माह")).toBe('"₹25,000 प्रति माह"');
  });
});
