const { reviewDiff } = require('./reviewBot');

const exampleDiff = `
diff --git a/src/utils/math.ts b/src/utils/math.ts
index 1234567..89abcde 100644
--- a/src/utils/math.ts
+++ b/src/utils/math.ts
@@ function sum(a: number, b: number): number {
-  return a + b;
+  return a + b + 1; // posible bug: off-by-one
}
`;

(async () => {
  console.log("📤 Enviando diff...");
  const review = await reviewDiff(exampleDiff);
  console.log("🧠 Review del LLM:\n", review);
})();
