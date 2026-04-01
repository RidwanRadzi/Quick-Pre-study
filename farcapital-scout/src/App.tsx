import { Routes, Route } from "react-router-dom";
import Index from "@/pages/Index";
import Tracker from "@/pages/Tracker";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/tracker" element={<Tracker />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
