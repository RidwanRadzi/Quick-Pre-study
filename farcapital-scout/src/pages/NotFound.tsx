import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 text-center">
      <p className="text-5xl font-bold text-muted-foreground/30">404</p>
      <p className="text-sm text-muted-foreground">Page not found.</p>
      <Button asChild size="sm" variant="outline">
        <Link to="/">Back to Scout</Link>
      </Button>
    </div>
  );
}
