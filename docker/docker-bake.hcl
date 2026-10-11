# The images of a version, built together (CI and local checks): docker buildx bake -f docker/docker-bake.hcl --load
variable "VERSION" { default = "ci" }

group "default" { targets = ["web", "migrate"] }

target "web" {
  context    = "."
  dockerfile = "docker/Dockerfile"
  target     = "web"
  args       = { VERSION = VERSION }
  tags       = ["ghcr.io/joinronde/ronde:${VERSION}"]
}

target "migrate" {
  context    = "."
  dockerfile = "docker/Dockerfile"
  target     = "migrate"
  tags       = ["ghcr.io/joinronde/ronde-migrate:${VERSION}"]
}
