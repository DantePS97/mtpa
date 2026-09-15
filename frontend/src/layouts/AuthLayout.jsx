```jsx
import { Outlet } from "react-router-dom";
import "./AuthLayout.css";

const AuthLayout = () => {
  return (
    <main className="auth-layout">
      <Outlet />
    </main>
  );
};

export default AuthLayout;
```
