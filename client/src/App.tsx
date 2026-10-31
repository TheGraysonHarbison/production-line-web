import { Navigate, Route, Routes } from "react-router";
import { PublicOnly, RequireAuth, SetupOnly } from "./components/Guards.tsx";
import { CalendarPage } from "./pages/CalendarPage.tsx";
import { DayPage } from "./pages/DayPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { RegisterPage } from "./pages/RegisterPage.tsx";
import { SetupPage } from "./pages/SetupPage.tsx";
import { Shell } from "./pages/Shell.tsx";
import { GeneralPage } from "./pages/settings/GeneralPage.tsx";
import { HomeAssistantPage } from "./pages/settings/HomeAssistantPage.tsx";
import { PrintersPage } from "./pages/settings/PrintersPage.tsx";
import { SettingsLayout } from "./pages/settings/SettingsLayout.tsx";
import { UsersPage } from "./pages/settings/UsersPage.tsx";

export function App() {
  return (
    <Routes>
      <Route
        path="/setup"
        element={
          <SetupOnly>
            <SetupPage />
          </SetupOnly>
        }
      />
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<CalendarPage />} />
        <Route path="/day/:date" element={<DayPage />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/settings/profile" replace />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="printers" element={<PrintersPage />} />
          <Route path="general" element={<GeneralPage />} />
          <Route path="home-assistant" element={<HomeAssistantPage />} />
          <Route path="users" element={<UsersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
