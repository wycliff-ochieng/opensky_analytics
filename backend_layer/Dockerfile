FROM golang:1.24-alpine AS build

WORKDIR /src

COPY go.mod ./
COPY go.sum ./
COPY app ./app
COPY main.go ./

RUN go build -o /out/opensky-backend ./main.go

FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY --from=build /out/opensky-backend /usr/local/bin/opensky-backend

EXPOSE 8080

CMD ["opensky-backend"]