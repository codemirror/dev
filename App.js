import React, { useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthContext } from "./components/context/authContext";
import Login from "./components/Login";
import Todos from "./components/Todos";
function App() {
  const { currentUser } = useContext(AuthContext);
  const RequiredAuth = ({ children }) => {
    return currentUser ? children : <Navigate to="/login" />;
  };
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <RequiredAuth>
                <Todos />
              </RequiredAuth>
            }
          />
          <Route path="/login" element={<Login />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
