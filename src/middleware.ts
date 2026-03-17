import { NextRequest, NextResponse } from "next/server";

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Protected Area"'
    }
  });
}

function decodeBasicAuth(value: string): { username: string; password: string } | null {
  const [scheme, encoded] = value.split(" ");

  if (scheme !== "Basic" || !encoded) {
    return null;
  }

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const expectedUsername = process.env.SITE_BASIC_AUTH_USERNAME?.trim();
  const expectedPassword = process.env.SITE_BASIC_AUTH_PASSWORD?.trim();

  if (!expectedUsername || !expectedPassword) {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return unauthorizedResponse();
  }

  const credentials = decodeBasicAuth(authorization);
  if (!credentials) {
    return unauthorizedResponse();
  }

  if (
    credentials.username !== expectedUsername ||
    credentials.password !== expectedPassword
  ) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
