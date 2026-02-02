import { describe, it, expect } from "bun:test";
import {
  extractName,
  sanitizeCandidate,
  isGreetingOrSmallTalk,
  isRenameIntent,
  extractRenameName,
  toTitleCase,
  isAskOwnName,
} from "./index";

describe("WA Logic - Name Extraction & Greeting", () => {
  describe("sanitizeCandidate", () => {
    it("should return null for empty input", () => {
      expect(sanitizeCandidate("")).toBeNull();
      expect(sanitizeCandidate("   ")).toBeNull();
      expect(sanitizeCandidate(null)).toBeNull();
    });

    it("should reject blacklisted generic words", () => {
      expect(sanitizeCandidate("kamu")).toBeNull();
      expect(sanitizeCandidate("bang")).toBeNull();
      expect(sanitizeCandidate("Kak")).toBeNull();
      expect(sanitizeCandidate("mas")).toBeNull();
      expect(sanitizeCandidate("panggil")).toBeNull();
    });

    it("should accept valid names", () => {
      expect(sanitizeCandidate("Rara")).toBe("Rara");
      expect(sanitizeCandidate("Budi Santoso")).toBe("Budi Santoso");
    });
  });

  describe("extractName", () => {
    it("should extract from 'aku [Name]'", () => {
      expect(extractName("aku Rara")).toBe("Rara");
      expect(extractName("halo aku Budi")).toBe("Budi");
    });

    it("should extract from 'nama saya [Name]'", () => {
      expect(extractName("nama saya Siti")).toBe("Siti");
      expect(extractName("hallo, nama saya Joko")).toBe("Joko");
    });

    it("should extract from 'panggil aku [Name]'", () => {
      expect(extractName("panggil aku Bos")).toBeNull(); // 'Bos' is blacklisted
      expect(extractName("panggil aku Tio")).toBe("Tio");
    });

    it("should return null if no pattern matches", () => {
      expect(extractName("harga berapa?")).toBeNull();
      expect(extractName("siapa kamu?")).toBeNull();
    });
  });

  describe("isGreetingOrSmallTalk", () => {
    it("should detect simple greetings", () => {
      expect(isGreetingOrSmallTalk("halo")).toBe(true);
      expect(isGreetingOrSmallTalk("pagi")).toBe(true);
      expect(isGreetingOrSmallTalk("selamat malam")).toBe(true);
    });

    it("should reject if it contains a question mark", () => {
      expect(isGreetingOrSmallTalk("halo?")).toBe(false);
      expect(isGreetingOrSmallTalk("apa kabar?")).toBe(false);
    });

    it("should reject long messages", () => {
      expect(
        isGreetingOrSmallTalk("halo saya mau tanya soal harga produk ini"),
      ).toBe(false);
    });
  });

  describe("Rename Logic", () => {
    it("should detect rename intent", () => {
      expect(isRenameIntent("ganti nama")).toBe(true);
      expect(isRenameIntent("ubah panggilan")).toBe(true);
      expect(isRenameIntent("panggil aku Stefi")).toBe(true);
    });

    it("should extract rename name", () => {
      expect(extractRenameName("panggil aku Stefi")).toBe("Stefi");
      expect(extractRenameName("ganti nama jadi Rara")).toBe("Rara");
    });
  });

  describe("Utilities", () => {
    it("should title case names", () => {
      expect(toTitleCase("rara")).toBe("Rara");
      expect(toTitleCase("BUDI SANTOSO")).toBe("Budi Santoso");
    });

    it("should detect asking own name", () => {
      expect(isAskOwnName("siapa nama saya?")).toBe(true);
      expect(isAskOwnName("namaku siapa")).toBe(true);
      expect(isAskOwnName("harga berapa")).toBe(false);
    });
  });
});
