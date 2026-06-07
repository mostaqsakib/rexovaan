import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";
import { CustomerAuthProvider } from "@/contexts/CustomerAuthContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import AdminConsole from "./pages/Index.tsx";
import AdminLogin from "./pages/AdminLogin.tsx";
import NotFound from "./pages/NotFound.tsx";
import CustomerLayout from "@/components/customer/CustomerLayout";
import Shop from "@/pages/customer/Shop";
import ProductDetail from "@/pages/customer/ProductDetail";
import Checkout from "@/pages/customer/Checkout";
import Login from "@/pages/customer/Login";
import Signup from "@/pages/customer/Signup";
import ForgotPassword from "@/pages/customer/ForgotPassword";
import ResetPassword from "@/pages/customer/ResetPassword";
import Unsubscribe from "@/pages/customer/Unsubscribe";
import Account from "@/pages/customer/Account";
import Orders from "@/pages/customer/Orders";
import Deposit from "@/pages/customer/Deposit";
import Deposits from "@/pages/customer/Deposits";
import Withdraw from "@/pages/customer/Withdraw";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <CustomerAuthProvider>
          <CurrencyProvider>
            <AdminAuthProvider>
              <Routes>
                {/* Customer site */}
                <Route element={<CustomerLayout />}>
                  <Route path="/" element={<Shop />} />
                  <Route path="/p/:code" element={<ProductDetail />} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/account" element={<Account />} />
                  <Route path="/account/orders" element={<Orders />} />
                  <Route path="/account/deposit" element={<Deposit />} />
                  <Route path="/account/deposits" element={<Deposits />} />
                  <Route path="/account/withdraw" element={<Withdraw />} />
                </Route>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />

                {/* Admin console */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<AdminConsole />} />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </AdminAuthProvider>
          </CurrencyProvider>
        </CustomerAuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
