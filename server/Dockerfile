FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY CollabBoard.Api/CollabBoard.Api.csproj CollabBoard.Api/
RUN dotnet restore CollabBoard.Api/CollabBoard.Api.csproj
COPY CollabBoard.Api/ CollabBoard.Api/
RUN dotnet publish CollabBoard.Api/CollabBoard.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "CollabBoard.Api.dll"]
