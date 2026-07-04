import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProducts from "./tools/list-products";
import getProduct from "./tools/get-product";
import myAccount from "./tools/my-account";
import myOrders from "./tools/my-orders";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "rexovaan-shoppie-mcp",
  title: "Rexovaan Shoppie",
  version: "0.1.0",
  instructions:
    "Tools for the Rexovaan Shoppie store. Use `list_products` and `get_product` to browse the catalog (public). Use `my_account` and `my_orders` to read the signed-in customer's own balance and order history.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProducts, getProduct, myAccount, myOrders],
});
