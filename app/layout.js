export const metadata = {
  title: "BTC 3D Dashboard",
  description: "Advanced Bitcoin trading dashboard with 3D visuals",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#000", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
