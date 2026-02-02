// Mock Database
const INVENTORY: Record<string, { price: number; stock: number }> = {
  laptop: { price: 15000000, stock: 5 },
  mouse: { price: 250000, stock: 12 },
  keyboard: { price: 500000, stock: 0 },
  monitor: { price: 3000000, stock: 3 },
};

// 1. Definisi Fungsi (Logic)
export function checkStock(itemName: string) {
  const key = itemName.toLowerCase();
  const item = INVENTORY[key];
  if (!item) {
    return JSON.stringify({ error: "Barang tidak ditemukan dalam database." });
  }
  return JSON.stringify({
    name: key,
    stock: item.stock,
    status: item.stock > 0 ? "Tersedia" : "Habis",
    price: item.price,
  });
}

// 2. Definisi Schema (OpenAI Tool Format)
export const checkStockTool = {
  type: "function" as const,
  function: {
    name: "check_stock",
    description:
      "Mengecek ketersediaan stok dan harga barang di gudang. Gunakan ini jika user bertanya 'apakah ada stok X?' atau 'berapa harga X?'.",
    parameters: {
      type: "object",
      properties: {
        itemName: {
          type: "string",
          description:
            "Nama barang yang ingin dicek (contoh: laptop, mouse, keyboard)",
        },
      },
      required: ["itemName"],
    },
  },
};

// Registry untuk memudahkan pemanggilan string -> function
export const TOOL_IMPLEMENTATIONS: Record<string, Function> = {
  check_stock: checkStock,
};
